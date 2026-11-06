import { spawn } from 'node:child_process';

/**
 * Phase 4 — live command execution.
 * Prefers `@lydell/node-pty` (real ConPTY/PTY) when installed; falls back to
 * `child_process.spawn` streaming so the TUI works without natives.
 * Approval semantics (blocked/caution + SessionApprovals) stay in the caller —
 * this module never executes without an explicit `run()` call.
 */

export interface PtyRunOptions {
  command: string;
  cwd: string;
  cols?: number;
  rows?: number;
  timeoutMs?: number;
  onData: (chunk: string) => void;
}

export interface PtyResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

async function loadNodePty(): Promise<any | null> {
  try {
    // @ts-ignore - optional native peer (tui/package.json optionalDependencies)
    return await import('@lydell/node-pty');
  } catch {
    return null;
  }
}

export async function runLive(opts: PtyRunOptions): Promise<PtyResult> {
  const pty = await loadNodePty();
  if (pty?.spawn) return runWithNodePty(pty, opts);
  return runWithChildProcess(opts);
}

function runWithNodePty(pty: any, opts: PtyRunOptions): Promise<PtyResult> {
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh';
  return new Promise((resolve) => {
    let output = '';
    let done = false;
    const finish = (exitCode: number, timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ output, exitCode, timedOut });
    };
    const term = pty.spawn(shell, process.platform === 'win32' ? ['-NoProfile', '-Command', opts.command] : ['-c', opts.command], {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd,
      env: process.env as Record<string, string>,
    });
    term.onData((d: string) => {
      output += d;
      opts.onData(d);
    });
    term.onExit(({ exitCode }: { exitCode: number }) => finish(exitCode, false));
    const timer = setTimeout(() => {
      try {
        term.kill();
      } catch {
        /* ignore */
      }
      finish(124, true);
    }, opts.timeoutMs ?? 600_000);
  });
}

function runWithChildProcess(opts: PtyRunOptions): Promise<PtyResult> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32';
    const child = spawn(opts.command, {
      cwd: opts.cwd,
      shell: shell ? 'powershell.exe' : true,
      windowsHide: true,
    });
    let output = '';
    let done = false;
    const finish = (exitCode: number, timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ output, exitCode, timedOut });
    };
    child.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
      opts.onData(d.toString());
    });
    child.stderr?.on('data', (d: Buffer) => {
      output += d.toString();
      opts.onData(d.toString());
    });
    child.on('close', (code) => finish(code ?? 0, false));
    child.on('error', () => finish(127, false));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(124, true);
    }, opts.timeoutMs ?? 600_000);
  });
}
