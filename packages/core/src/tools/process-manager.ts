/**
 * ProcessManager — background process tracking for the `terminal` / `process` tools.
 *
 * Long-running commands (dev servers, watchers, tails) are started with
 * `background: true`; the agent then polls logs, writes to stdin, or kills them.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import treeKill from 'tree-kill';
import { buildShellInvocation } from './command-executor.js';

export interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  startedAt: number;
  exitedAt?: number;
  exitCode: number | null;
  signal: string | null;
  status: 'running' | 'exited' | 'killed';
  logs: string[];
  logOffset: number; // number of lines dropped from the front
  child: ChildProcess;
  label?: string;
}

const MAX_LOG_LINES = 4000;


export class ProcessManager {
  private procs = new Map<string, ManagedProcess>();
  private counter = 0;

  start(command: string, cwd: string, opts: { env?: Record<string, string | undefined>; label?: string } = {}): ManagedProcess {
    const inv = buildShellInvocation(command);
    const child = spawn(inv.file, inv.args, {
      cwd,
      env: { ...process.env, ...opts.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
      detached: platform() !== 'win32',
    });
    const id = `p${++this.counter}`;
    const mp: ManagedProcess = {
      id,
      command,
      cwd,
      pid: child.pid,
      startedAt: Date.now(),
      exitCode: null,
      signal: null,
      status: 'running',
      logs: [],
      logOffset: 0,
      child,
      label: opts.label,
    };
    const push = (chunk: Buffer, prefix = '') => {
      const lines = chunk.toString('utf-8').split(/\r?\n/);
      for (const l of lines) {
        if (l === '' && lines.length > 1) continue;
        mp.logs.push(prefix + l);
      }
      if (mp.logs.length > MAX_LOG_LINES) {
        const drop = mp.logs.length - MAX_LOG_LINES;
        mp.logs.splice(0, drop);
        mp.logOffset += drop;
      }
    };
    child.stdout?.on('data', (c: Buffer) => push(c));
    child.stderr?.on('data', (c: Buffer) => push(c, ''));
    child.on('close', (code, signal) => {
      mp.exitCode = code;
      mp.signal = signal ? String(signal) : null;
      mp.exitedAt = Date.now();
      if (mp.status === 'running') mp.status = 'exited';
    });
    child.on('error', err => {
      mp.logs.push(`[spawn error] ${err.message}`);
      mp.status = 'exited';
      mp.exitCode = 1;
      mp.exitedAt = Date.now();
    });
    this.procs.set(id, mp);
    return mp;
  }

  get(id: string): ManagedProcess | undefined {
    return this.procs.get(id) ?? Array.from(this.procs.values()).find(p => String(p.pid) === id);
  }

  list(): ManagedProcess[] {
    return Array.from(this.procs.values());
  }

  running(): ManagedProcess[] {
    return this.list().filter(p => p.status === 'running');
  }

  /** Return log lines since `fromLine` (absolute line index) — or the tail. */
  poll(id: string, opts: { fromLine?: number; tail?: number } = {}): { lines: string[]; nextLine: number; proc: ManagedProcess } {
    const proc = this.get(id);
    if (!proc) throw new Error(`No such process: ${id}`);
    const total = proc.logOffset + proc.logs.length;
    let start: number;
    if (opts.fromLine !== undefined) start = Math.max(proc.logOffset, opts.fromLine);
    else start = Math.max(proc.logOffset, total - (opts.tail ?? 100));
    const lines = proc.logs.slice(start - proc.logOffset);
    return { lines, nextLine: total, proc };
  }

  /** Block until a regex matches new output, the process exits, or timeout. */
  async waitFor(id: string, pattern: RegExp | null, timeoutMs: number): Promise<{ matched: boolean; exited: boolean; lines: string[] }> {
    const proc = this.get(id);
    if (!proc) throw new Error(`No such process: ${id}`);
    const startLine = proc.logOffset + proc.logs.length;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { lines } = this.poll(id, { fromLine: startLine });
      if (pattern && lines.some(l => pattern.test(l))) return { matched: true, exited: proc.status !== 'running', lines };
      if (proc.status !== 'running') return { matched: false, exited: true, lines };
      await new Promise(r => setTimeout(r, 200));
    }
    return { matched: false, exited: proc.status !== 'running', lines: this.poll(id, { fromLine: startLine }).lines };
  }

  write(id: string, input: string): void {
    const proc = this.get(id);
    if (!proc) throw new Error(`No such process: ${id}`);
    if (proc.status !== 'running') throw new Error(`Process ${id} is not running`);
    proc.child.stdin?.write(input);
  }

  async kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const proc = this.get(id);
    if (!proc) return false;
    if (proc.status !== 'running') return true;
    proc.status = 'killed';
    await new Promise<void>(resolve => {
      if (!proc.pid) return resolve();
      treeKill(proc.pid, signal, () => resolve());
    });
    setTimeout(() => {
      if (proc.exitCode === null && proc.pid) {
        try {
          treeKill(proc.pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }, 3000).unref();
    return true;
  }

  async killAll(): Promise<number> {
    const running = this.running();
    await Promise.all(running.map(p => this.kill(p.id)));
    return running.length;
  }

  remove(id: string): void {
    this.procs.delete(id);
  }
}

export const processManager = new ProcessManager();

// Ensure children die with the CLI.
const cleanup = () => {
  for (const p of processManager.running()) {
    try {
      if (p.pid) treeKill(p.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
};
process.once('exit', cleanup);
process.once('SIGINT', () => {
  cleanup();
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(143);
});
