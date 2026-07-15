/**
 * Tool: Execute Command
 * Runs shell commands with output capture and safety checks.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

// Commands that are always blocked for safety
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'format c:',
  'del /f /s /q c:\\',
  'mkfs',
  ':(){:|:&};:',
];

// Commands that require explicit confirmation
const DANGEROUS_PREFIXES = [
  'rm ', 'del ', 'rmdir',
  'git push', 'git reset --hard',
  'npm publish',
  'sudo ',
  'chmod ', 'chown ',
  'kill ', 'taskkill',
];

export const execCommandTool = {
  definition: {
    type: 'function',
    function: {
      name: 'executeCommand',
      description:
        'Execute a shell command and return its output. ' +
        'Use this for running tests, installing packages, git operations, etc. ' +
        'The user will be asked to confirm before execution.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command. Defaults to current project directory.',
          },
        },
        required: ['command'],
      },
    },
  },

  /**
   * Execute the command tool.
   * @param {object} args - { command, cwd? }
   * @param {string} defaultCwd - Default working directory
   * @param {object} options - { confirmFn }
   * @returns {Promise<string>}
   */
  async execute(args, defaultCwd, options = {}) {
    const command = args.command.trim();
    const cwd = resolve(args.cwd || defaultCwd);

    // Safety check: block dangerous commands
    for (const blocked of BLOCKED_COMMANDS) {
      if (command.toLowerCase().includes(blocked.toLowerCase())) {
        return `⚠ BLOCKED: This command is too dangerous to execute: "${command}"`;
      }
    }

    // Determine if command needs confirmation
    const isDangerous = DANGEROUS_PREFIXES.some((prefix) =>
      command.toLowerCase().startsWith(prefix.toLowerCase())
    );

    // Ask for confirmation
    if (options.confirmFn) {
      const confirmed = await options.confirmFn(command, cwd);
      if (!confirmed) {
        return `Command execution cancelled by user.`;
      }
    }

    try {
      const output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout: 60_000, // 60 second timeout
        maxBuffer: 5 * 1024 * 1024, // 5MB output buffer
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const trimmed = output.trim();
      if (!trimmed) {
        return `✔ Command completed successfully (no output).\n$ ${command}`;
      }

      // Truncate very long output
      if (trimmed.length > 10_000) {
        return `$ ${command}\n${'─'.repeat(40)}\n${trimmed.slice(0, 10_000)}\n... (output truncated, ${trimmed.length} total chars)`;
      }

      return `$ ${command}\n${'─'.repeat(40)}\n${trimmed}`;
    } catch (err) {
      const stderr = err.stderr?.trim() || '';
      const stdout = err.stdout?.trim() || '';
      const output = stderr || stdout || err.message;

      return `✖ Command failed (exit code ${err.status || 1}):\n$ ${command}\n${'─'.repeat(40)}\n${output.slice(0, 5000)}`;
    }
  },
};
