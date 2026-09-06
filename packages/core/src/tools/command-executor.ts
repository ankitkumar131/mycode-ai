import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import treeKill from 'tree-kill';
import type { ExecutionResult } from './types.js';

const MAX_OUTPUT_LENGTH = 100_000;
const MAX_LOG_LINES = 500;

export interface ExecutorOptions {
  timeout?: number;
  abortSignal?: AbortSignal;
  env?: Record<string, string | undefined>;
  onLog?: (line: string) => void;
}

/**
 * Build the shell invocation. On Windows we must bypass Node's automatic
 * argument quoting (windowsVerbatimArguments) — otherwise every quote inside
 * the command is escaped as \" and cmd.exe receives a mangled command line.
 * `cmd /d /s /c "<command>"` strips exactly the outer quotes we add.
 */
export function buildShellInvocation(command: string): { file: string; args: string[]; verbatim: boolean } {
  if (platform() === 'win32') {
    const file = process.env.COMSPEC || 'cmd.exe';
    return { file, args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-c', command], verbatim: false };
}

export function executeCommand(
  command: string,
  cwd: string,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  return new Promise(resolve => {
    const startTime = Date.now();
    const inv = buildShellInvocation(command);
    const timeout = options.timeout ?? 30_000;
    let timedOut = false;
    let killed = false;
    let stdout = '';
    let stderr = '';
    let lineCount = 0;

    const proc = spawn(inv.file, inv.args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
    });

    let abortHandler: (() => void) | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && options.abortSignal) {
        options.abortSignal.removeEventListener('abort', abortHandler);
      }
    };

    const handleAbort = () => {
      killed = true;
      cleanup();
      treeKill(proc.pid!, 'SIGTERM', err => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ESRCH') {
          proc.kill('SIGKILL');
        }
      });
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      handleAbort();
    }, timeout);

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        killed = true;
        cleanup();
        treeKill(proc.pid!, 'SIGTERM');
      } else {
        abortHandler = handleAbort;
        options.abortSignal.addEventListener('abort', handleAbort, { once: true });
      }
    }

    const appendOutput = (buffer: string, target: 'stdout' | 'stderr') => {
      if (lineCount >= MAX_LOG_LINES) return;
      const lines = buffer.split('\n').filter(Boolean);
      for (const line of lines) {
        if (lineCount >= MAX_LOG_LINES) break;
        options.onLog?.(line);
        lineCount++;
      }
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n...(truncated)';
      }
      appendOutput(text, 'stdout');
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      if (stderr.length > MAX_OUTPUT_LENGTH) {
        stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n...(truncated)';
      }
      appendOutput(text, 'stderr');
    });

    proc.on('close', (code, signal) => {
      cleanup();
      const durationMs = Date.now() - startTime;

      let output = stdout;
      if (stderr) {
        output += output ? '\n' + stderr : stderr;
      }

      const truncated = stdout.length >= MAX_OUTPUT_LENGTH || stderr.length >= MAX_OUTPUT_LENGTH;
      let status: ExecutionResult['status'];
      if (killed) status = timedOut ? 'timeout' : 'killed';
      else if (code === 0) status = 'success';
      else status = 'failed';

      resolve({
        exitCode: code,
        signal: signal?.toString() ?? null,
        stdout,
        stderr,
        output,
        durationMs,
        timedOut,
        killed,
        truncated,
        status,
      });
    });

    proc.on('error', err => {
      cleanup();
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: err.message,
        output: err.message,
        durationMs,
        timedOut: false,
        killed: false,
        truncated: false,
        status: 'failed',
      });
    });
  });
}
