import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';

export interface BrowserVerifierConfig {
  /** Executable that hosts the Jev bridge, for example `python`. */
  command?: string;
  /** Arguments. `{json}`, `{url}`, `{goal}`, and `{cwd}` are replaced. */
  args?: string[];
  enabled?: boolean;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface BrowserVerificationRequest {
  url: string;
  goal: string;
  expected?: string[];
  cwd?: string;
  recordDir?: string;
  allowMutations?: boolean;
}

export interface BrowserVerificationResult {
  success: boolean;
  status: 'passed' | 'failed' | 'blocked' | 'unavailable' | 'timeout';
  summary: string;
  url?: string;
  finalUrl?: string;
  pageText?: string;
  evidence?: unknown;
  error?: string;
  durationMs?: number;
}

export interface BrowserVerifier {
  verify(
    request: BrowserVerificationRequest,
    options?: { cwd?: string; signal?: AbortSignal },
  ): Promise<BrowserVerificationResult>;
}

function parseOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    // Bridges sometimes log startup information before their JSON response.
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim());
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      } catch {
        /* continue */
      }
    }
    return null;
  }
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Runs a Jev-compatible JSON-over-stdin bridge without importing Python into
 * the Node process. This keeps browser automation optional and replaceable.
 */
export class ExternalBrowserVerifier implements BrowserVerifier {
  constructor(
    private readonly config: BrowserVerifierConfig,
    private readonly defaultCwd = process.cwd(),
  ) {}

  isConfigured(): boolean {
    return this.config.enabled !== false && !!this.config.command;
  }

  async verify(
    request: BrowserVerificationRequest,
    options: { cwd?: string; signal?: AbortSignal } = {},
  ): Promise<BrowserVerificationResult> {
    const cwd = options.cwd ?? this.defaultCwd;
    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'unavailable',
        summary: 'No browser verifier is configured.',
        url: request.url,
        error: 'Configure integrations.browser.command and install the Jev bridge.',
      };
    }

    const startedAt = Date.now();
    const payload = { ...request, cwd };
    const json = JSON.stringify(payload);
    const args = (this.config.args ?? []).map(arg => arg
      .replaceAll('{json}', json)
      .replaceAll('{url}', request.url)
      .replaceAll('{goal}', request.goal)
      .replaceAll('{cwd}', cwd));
    const timeoutMs = Math.max(1_000, Math.min(this.config.timeoutMs ?? 180_000, 1_800_000));

    return new Promise(resolve => {
      const child = spawn(this.config.command!, args, {
        cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: BrowserVerificationResult): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
        resolve({ ...result, durationMs: result.durationMs ?? Date.now() - startedAt });
      };

      const stop = (): void => {
        if (!child.pid) return;
        try {
          treeKill(child.pid, 'SIGTERM', () => undefined);
        } catch {
          child.kill();
        }
      };

      const abortHandler = (): void => {
        stop();
        finish({
          success: false,
          status: 'timeout',
          summary: 'Browser verification was aborted.',
          url: request.url,
          error: 'The parent task was cancelled.',
        });
      };

      timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);

      if (options.signal) {
        if (options.signal.aborted) {
          abortHandler();
          return;
        }
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
        if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
        if (stderr.length > 50_000) stderr = stderr.slice(-50_000);
      });
      child.on('error', error => finish({
        success: false,
        status: 'unavailable',
        summary: 'The browser verifier process could not be started.',
        url: request.url,
        error: error.message,
      }));
      child.on('close', code => {
        if (timedOut) {
          finish({
            success: false,
            status: 'timeout',
            summary: `Browser verification timed out after ${timeoutMs}ms.`,
            url: request.url,
            error: stderr.trim() || 'Verifier timeout.',
          });
          return;
        }
        const data = parseOutput(stdout);
        if (!data) {
          finish({
            success: false,
            status: 'failed',
            summary: 'The browser verifier returned no JSON result.',
            url: request.url,
            error: stderr.trim() || `Verifier exited with code ${code ?? 'unknown'}.`,
          });
          return;
        }
        const passed = bool(data.success) ?? bool(data.passed) ?? (data.status === 'passed' || data.status === 'done');
        const status = data.status === 'blocked' ? 'blocked' : passed ? 'passed' : 'failed';
        finish({
          success: passed,
          status,
          summary: string(data.summary) ?? (passed ? 'Browser verification passed.' : 'Browser verification failed.'),
          url: request.url,
          finalUrl: string(data.finalUrl) ?? string(data.url),
          pageText: string(data.pageText),
          evidence: data.evidence ?? data,
          error: string(data.error) ?? (passed ? undefined : stderr.trim() || undefined),
        });
      });

      child.stdin.write(json);
      child.stdin.end();
    });
  }
}
