import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';

export type DecisionQuestionType = 'choice' | 'score' | 'noul';

export interface DecisionQuestion {
  type: DecisionQuestionType;
  instructions: string;
  criteria?: unknown;
}

export interface DecisionGateConfig {
  /** Executable hosting the Laya JSON bridge, for example `python`. */
  command?: string;
  /** Arguments. `{json}`, `{state}`, and `{cwd}` are replaced. */
  args?: string[];
  enabled?: boolean;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  model?: string;
  maxLen?: number;
  minConfidence?: number;
}

export interface DecisionResult {
  success: boolean;
  status: 'completed' | 'unavailable' | 'failed' | 'timeout';
  answers?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  confidence?: number;
  raw?: unknown;
  summary: string;
  error?: string;
  durationMs?: number;
}

export interface DecisionGate {
  decide(request: DecisionRequest, options?: { cwd?: string; signal?: AbortSignal }): Promise<DecisionResult>;
}

function parseOutput(output: string): Record<string, unknown> | null {
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line.trim());
      if (value && typeof value === 'object') return value as Record<string, unknown>;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

/** Runs Laya through a replaceable JSON bridge instead of coupling core to Python. */
export class ExternalDecisionGate implements DecisionGate {
  constructor(
    private readonly config: DecisionGateConfig,
    private readonly defaultCwd = process.cwd(),
  ) {}

  isConfigured(): boolean {
    return this.config.enabled !== false && !!this.config.command;
  }

  async decide(
    request: DecisionRequest,
    options: { cwd?: string; signal?: AbortSignal } = {},
  ): Promise<DecisionResult> {
    const cwd = options.cwd ?? this.defaultCwd;
    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'unavailable',
        summary: 'No decision gate is configured.',
        error: 'Configure integrations.decision.command and install the Laya bridge.',
      };
    }

    const startedAt = Date.now();
    const json = JSON.stringify({ ...request, cwd });
    const state = typeof request.state === 'string' ? request.state : JSON.stringify(request.state);
    const args = (this.config.args ?? []).map(arg => arg
      .replaceAll('{json}', json)
      .replaceAll('{state}', state)
      .replaceAll('{cwd}', cwd));
    const timeoutMs = Math.max(1_000, Math.min(this.config.timeoutMs ?? 30_000, 600_000));

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

      const finish = (result: DecisionResult): void => {
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
        finish({ success: false, status: 'timeout', summary: 'Decision gate was aborted.', error: 'Parent task cancelled.' });
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
        summary: 'The decision gate process could not be started.',
        error: error.message,
      }));
      child.on('close', code => {
        if (timedOut) {
          finish({ success: false, status: 'timeout', summary: `Decision gate timed out after ${timeoutMs}ms.`, error: stderr.trim() || undefined });
          return;
        }
        const data = parseOutput(stdout);
        if (!data) {
          finish({
            success: false,
            status: 'failed',
            summary: 'The decision gate returned no JSON result.',
            error: stderr.trim() || `Decision gate exited with code ${code ?? 'unknown'}.`,
          });
          return;
        }
        const answers = data.answers ?? data.result;
        finish({
          success: data.success !== false && !!answers,
          status: data.success === false ? 'failed' : 'completed',
          answers: answers && typeof answers === 'object' ? answers as Record<string, unknown> : undefined,
          routing: data.routing && typeof data.routing === 'object' ? data.routing as Record<string, unknown> : undefined,
          confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
          raw: data,
          summary: typeof data.summary === 'string' ? data.summary : 'Laya decision completed.',
          error: typeof data.error === 'string' ? data.error : undefined,
        });
      });

      child.stdin.write(json);
      child.stdin.end();
    });
  }
}
