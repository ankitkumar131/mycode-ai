import type { ToolModule } from '../types.js';

export const execCommandTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'exec-command',
      description: 'Execute a shell command and return its output',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what this command does',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args, cwd, options) {
    const command = typeof args.command === 'string' ? args.command : '';
    const description = typeof args.description === 'string' ? args.description : undefined;
    const timeout = typeof args.timeout === 'number' ? args.timeout : 30_000;

    if (!command) {
      throw new Error('Command is required');
    }

    if (options?.abortSignal?.aborted) {
      return 'Command execution aborted.';
    }

    const { executeCommand } = await import('../command-executor.js');
    const { classifyCommand } = await import('../command-safety.js');

    const safety = classifyCommand(command);
    if (safety.level === 'blocked') {
      throw new Error(`Command blocked: ${safety.reason}`);
    }

    if (
      safety.level === 'dangerous' &&
      options?.confirmFn
    ) {
      const confirmed = await options.confirmFn(command, description ?? null, safety);
      if (!confirmed) {
        if (options.commandHistory) {
          options.commandHistory.add({
            command,
            cwd,
            exitCode: null,
            signal: null,
            durationMs: 0,
            status: 'cancelled',
            output: 'Cancelled by user',
            outputPreview: 'Cancelled by user',
          });
        }
        return 'Command execution cancelled.';
      }
    }

    const result = await executeCommand(command, cwd, {
      timeout,
      abortSignal: options?.abortSignal,
    });

    if (options?.commandHistory) {
      options.commandHistory.add({
        command,
        cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        status: result.status,
        output: result.output,
        outputPreview: result.output.slice(0, 200),
      });
    }

    const parts: string[] = [];
    if (result.output) {
      parts.push(result.output);
    }
    parts.push(`\nExit code: ${result.exitCode ?? result.signal ?? 'unknown'}`);
    parts.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

    if (result.timedOut) {
      parts.push('Result: TIMED OUT');
    } else if (result.killed) {
      parts.push('Result: KILLED');
    } else if (result.exitCode === 0) {
      parts.push('Result: SUCCESS');
    } else {
      parts.push('Result: FAILED');
    }

    return parts.join('\n');
  },
};
