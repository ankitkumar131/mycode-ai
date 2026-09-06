/**
 * terminal — Execute shell commands (foreground or background).
 *
 * Foreground: runs to completion (with timeout) and returns stdout+stderr.
 * Background: returns immediately with a process id; use the `process` tool
 * to poll logs, wait for a pattern, send stdin, or kill.
 */

import type { ToolModule } from '../types.js';

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT = 120_000;

export const execCommandTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'terminal',
      description:
        'Run a shell command in the working directory and return its output. Use for builds, tests, git, package managers, and any CLI work. Set background=true for long-running processes (dev servers, watchers) and manage them with the process tool. Output is truncated when very long — prefer filtering (grep, head, --quiet).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          description: { type: 'string', description: 'Short human-readable description of what this command does (shown to the user)' },
          timeout: { type: 'number', description: 'Timeout in milliseconds for foreground commands (default 120000, max 1800000)' },
          background: { type: 'boolean', description: 'Start in the background and return a process id immediately' },
          cwd: { type: 'string', description: 'Optional subdirectory (relative to the workspace) to run in' },
        },
        required: ['command'],
      },
    },
  },

  async execute(args, cwd, options) {
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    const description = typeof args.description === 'string' ? args.description : undefined;
    const timeout = Math.min(1_800_000, typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT);
    const background = args.background === true;

    if (!command) throw new Error('Command is required');
    if (options?.abortSignal?.aborted) return 'Command execution aborted.';

    const { resolve, relative, isAbsolute } = await import('node:path');
    let runCwd = cwd;
    if (typeof args.cwd === 'string' && args.cwd.trim()) {
      const target = resolve(cwd, args.cwd);
      const rel = relative(cwd, target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`cwd must be inside the workspace: ${args.cwd}`);
      runCwd = target;
    }

    const { classifyCommand } = await import('../command-safety.js');
    const safety = classifyCommand(command);
    if (safety.level === 'blocked') throw new Error(`Command blocked: ${safety.reason}`);

    if (options?.confirmFn) {
      const confirmed = await options.confirmFn(command, description ?? null, safety);
      if (!confirmed) {
        options.commandHistory?.add({ command, cwd: runCwd, exitCode: null, signal: null, durationMs: 0, status: 'cancelled', output: 'Cancelled by user', outputPreview: 'Cancelled by user' });
        return 'Command execution cancelled by user. Ask before retrying, or try a different approach.';
      }
    }

    if (background) {
      const { processManager } = await import('../process-manager.js');
      const proc = processManager.start(command, runCwd, { label: description });
      // Give it a moment to fail fast / print a first line.
      await new Promise(r => setTimeout(r, 800));
      const { lines } = processManager.poll(proc.id, { tail: 30 });
      const state = proc.status === 'running' ? `running (pid ${proc.pid})` : `exited with code ${proc.exitCode}`;
      return [`Started background process ${proc.id}: ${state}`, lines.length ? `Initial output:\n${lines.join('\n')}` : '(no output yet)', `Use process(action="logs", id="${proc.id}") to read output, process(action="kill", id="${proc.id}") to stop.`].join('\n');
    }

    const { executeCommand } = await import('../command-executor.js');
    const result = await executeCommand(command, runCwd, { timeout, abortSignal: options?.abortSignal });

    options?.commandHistory?.add({
      command,
      cwd: runCwd,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      status: result.status,
      output: result.output,
      outputPreview: result.output.slice(0, 200),
    });

    let output = result.output || '';
    if (output.length > MAX_OUTPUT_CHARS) {
      const head = output.slice(0, MAX_OUTPUT_CHARS * 0.45);
      const tail = output.slice(-MAX_OUTPUT_CHARS * 0.45);
      output = `${head}\n... [${output.length - head.length - tail.length} characters truncated — re-run with a filter (grep/head/tail) to see more] ...\n${tail}`;
    }

    const parts: string[] = [];
    if (output.trim()) parts.push(output.trimEnd());
    else parts.push('(no output)');
    const status = result.timedOut ? 'TIMED OUT' : result.killed ? 'KILLED' : result.exitCode === 0 ? 'SUCCESS' : 'FAILED';
    parts.push(`\n[exit ${result.exitCode ?? result.signal ?? '?'} · ${(result.durationMs / 1000).toFixed(1)}s · ${status}]`);
    return parts.join('\n');
  },
};
