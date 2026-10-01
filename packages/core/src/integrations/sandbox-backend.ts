import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';

export interface SandboxBackendConfig {
  /** AX CLI executable, normally `ax`. */
  command?: string;
  /** Global arguments placed before every AX subcommand. */
  args?: string[];
  enabled?: boolean;
  timeoutMs?: number;
  image?: string;
  workspaceName?: string;
  atespace?: string;
  /** AX CLI command templates. `{manifest}`, `{name}`, and `{cwd}` are replaced. */
  applyArgs?: string[];
  resumeArgs?: string[];
  watchArgs?: string[];
  deleteArgs?: string[];
  resume?: boolean;
  deleteOnFinish?: boolean;
  successPattern?: string;
  failurePattern?: string;
  env?: Record<string, string>;
}

export interface SandboxTaskRequest {
  name?: string;
  goal: string;
  cwd: string;
  command?: string[];
  image?: string;
  workspaceName?: string;
  atespace?: string;
  env?: Record<string, string>;
  readOnly?: boolean;
  debug?: boolean;
}

export interface SandboxTaskResult {
  success: boolean;
  status: 'completed' | 'failed' | 'unavailable' | 'timeout' | 'blocked';
  taskName?: string;
  summary: string;
  output?: string;
  error?: string;
  evidence?: Record<string, unknown>;
  durationMs?: number;
}

export interface SandboxBackend {
  runTask(request: SandboxTaskRequest, options?: { signal?: AbortSignal }): Promise<SandboxTaskResult>;
}

interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0,  fortyEight);
}

const fortyEight = 48;

function replaceTemplate(value: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((result, [key, replacement]) => result.replaceAll(`{${key}}`, replacement), value);
}

/**
 * AX CLI backend. It submits a task manifest, resumes it when requested, and
 * watches the task until the AX command exits. AX remains optional: without a
 * configured executable this backend returns an explicit unavailable result.
 */
export class AxCliSandboxBackend implements SandboxBackend {
  constructor(
    private readonly config: SandboxBackendConfig,
    private readonly defaultCwd = process.cwd(),
  ) {}

  isConfigured(): boolean {
    return this.config.enabled !== false && !!this.config.command;
  }

  async runTask(request: SandboxTaskRequest, options: { signal?: AbortSignal } = {}): Promise<SandboxTaskResult> {
    const cwd = request.cwd || this.defaultCwd;
    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'unavailable',
        summary: 'No AX sandbox backend is configured.',
        error: 'Configure integrations.sandbox.command and an AX cluster before requesting sandbox execution.',
      };
    }
    const image = request.image ?? this.config.image;
    if (!image) {
      return {
        success: false,
        status: 'blocked',
        summary: 'AX task was not submitted because no container image was configured.',
        error: 'Set integrations.sandbox.image or pass an image to sandbox_task.',
      };
    }

    const name = safeName(request.name ?? `mycode-${Date.now().toString(36)}`) || `mycode-${Date.now().toString(36)}`;
    const tempDir = await mkdtemp(join(tmpdir(), 'mycode-ax-'));
    const manifestPath = join(tempDir, `${name}.json`);
    const workspaceName = request.workspaceName ?? this.config.workspaceName;
    const taskSpec: Record<string, unknown> = {
      apiVersion: 'ax.io/v1alpha1',
      kind: 'Task',
      metadata: { name, ...(request.atespace ?? this.config.atespace ? { atespace: request.atespace ?? this.config.atespace } : {}) },
      spec: {
        image,
        ...(request.command?.length ? { command: request.command } : {}),
        ...(request.env || this.config.env ? { env: Object.entries({ ...this.config.env, ...request.env }).map(([key, value]) => ({ name: key, value })) } : {}),
        ...(workspaceName ? { workspaces: [{ name: workspaceName, path: '/workspace' }] } : {}),
        debug: request.debug === true,
        labels: { 'mycode.goal': request.goal.slice(0, 240) },
      },
    };

    try {
      // JSON is valid YAML and avoids adding a YAML dependency to the Node CLI.
      await writeFile(manifestPath, JSON.stringify(taskSpec, null, 2), 'utf8');
      const replacements = { manifest: manifestPath, name, cwd };
      const run = (template: string[], timeoutMs = this.config.timeoutMs ?? 900_000) => this.command(
        [...(this.config.args ?? []), ...template.map(item => replaceTemplate(item, replacements))],
        cwd,
        timeoutMs,
        options.signal,
      );

      const applied = await run(this.config.applyArgs ?? ['apply', '-f', '{manifest}']);
      if (applied.timedOut || applied.code !== 0) {
        return this.failedResult(name, applied, 'AX apply failed.');
      }

      if (this.config.resume !== false) {
        const resumed = await run(this.config.resumeArgs ?? ['resume', 'task', '{name}']);
        if (resumed.timedOut || resumed.code !== 0) {
          return this.failedResult(name, resumed, 'AX resume failed.');
        }
      }

      const watched = await run(this.config.watchArgs ?? ['watch', 'task', '{name}']);
      const output = watched.output;
      if (watched.timedOut) return this.failedResult(name, watched, 'AX task watch timed out.', 'timeout');
      if (watched.code !== 0) return this.failedResult(name, watched, 'AX task watch failed.');

      const failure = new RegExp(this.config.failurePattern ?? '\\b(failed|failure|error|terminated)\\b', 'i').test(output);
      const successPattern = new RegExp(this.config.successPattern ?? '\\b(succeeded|successful|completed|done|finished)\\b', 'i');
      const success = !failure && (successPattern.test(output) || output.trim().length > 0);
      const result: SandboxTaskResult = {
        success,
        status: success ? 'completed' : 'failed',
        taskName: name,
        summary: success ? 'AX sandbox task completed.' : 'AX sandbox task did not report success.',
        output,
        error: success ? undefined : 'AX watch output did not contain a successful terminal state.',
        evidence: { apply: applied.output, watch: output },
        durationMs: undefined,
      };

      if (this.config.deleteOnFinish) {
        await run(this.config.deleteArgs ?? ['delete', 'task', '{name}']);
      }
      return result;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private failedResult(
    taskName: string,
    command: CommandResult,
    summary: string,
    status: SandboxTaskResult['status'] = 'failed',
  ): SandboxTaskResult {
    return {
      success: false,
      status,
      taskName,
      summary,
      output: command.output,
      error: command.output.slice(-4_000) || summary,
    };
  }

  private command(args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
    return new Promise(resolve => {
      const child = spawn(this.config.command!, args, {
        cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let output = '';
      let timedOut = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: CommandResult): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        resolve(result);
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
        finish({ code: null, output: 'AX command aborted.', timedOut: true });
      };
      timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, Math.max(1_000, Math.min(timeoutMs, 1_800_000)));
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 200_000) output = output.slice(-200_000);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', error => finish({ code: 1, output: error.message, timedOut: false }));
      child.on('close', code => finish({ code, output, timedOut }));
    });
  }
}
