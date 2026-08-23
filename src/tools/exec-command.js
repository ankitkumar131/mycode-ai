/**
 * Tool: Execute Command
 * Full-featured command execution tool for the AI agent.
 *
 * Uses the CommandExecutor for real-time streaming, and the
 * CommandSafety system for classification and blocking.
 */

import { resolve } from 'path';
import { classifyCommand, isBlocked, getSafetyLabel } from './command-safety.js';
import { executeCommand } from './command-executor.js';

export const execCommandTool = {
  definition: {
    type: 'function',
    function: {
      name: 'executeCommand',
      description:
        'Execute a shell command and return its output. ' +
        'Use this for running tests, installing packages, builds, git operations, ' +
        'checking file contents, running scripts, and any other terminal command. ' +
        'Output is streamed in real-time. The user will be asked to confirm before execution. ' +
        'Commands run in the OS default shell (cmd.exe on Windows, /bin/sh on Unix).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.',
          },
          cwd: {
            type: 'string',
            description:
              'Working directory for the command. Defaults to the current project directory.',
          },
          timeout: {
            type: 'number',
            description:
              'Timeout in seconds. Default is 120. Use 0 for no timeout (for long builds). ' +
              'Use a shorter timeout for quick commands like "git status".',
          },
        },
        required: ['command'],
      },
    },
  },

  /**
   * Execute the command tool.
   * @param {object} args - { command, cwd?, timeout? }
   * @param {string} defaultCwd - Default working directory
   * @param {object} options - { confirmFn, commandHistory, abortSignal }
   * @returns {Promise<string>} Result string for AI context
   */
  async execute(args, defaultCwd, options = {}) {
    const command = args.command.trim();
    const cwd = resolve(args.cwd || defaultCwd);

    // ── Step 1: Safety check ──
    const { blocked, reason } = isBlocked(command);
    if (blocked) {
      return `🚫 BLOCKED: This command is too dangerous to execute.\n` +
        `Command: ${command}\nReason: ${reason}\n\n` +
        `This command cannot be executed for safety reasons. ` +
        `Please use a safer alternative.`;
    }

    // Get safety classification for the confirmation prompt
    const safety = classifyCommand(command);

    // ── Step 2: User confirmation ──
    if (options.confirmFn) {
      const confirmed = await options.confirmFn(command, cwd, safety);
      if (!confirmed) {
        // Record cancellation in history
        if (options.commandHistory) {
          options.commandHistory.add({
            command,
            cwd,
            exitCode: null,
            signal: null,
            durationMs: 0,
            status: 'cancelled',
            output: '',
          });
        }
        return `Command execution cancelled by user.\n$ ${command}`;
      }
    }

    // ── Step 3: Determine timeout ──
    let timeoutMs;
    if (args.timeout !== undefined && args.timeout !== null) {
      timeoutMs = args.timeout * 1000; // Convert seconds to ms
    } else {
      // Smart defaults based on command type
      timeoutMs = getSmartTimeout(command);
    }

    // ── Step 4: Execute with streaming ──
    const result = await executeCommand(command, {
      cwd,
      timeoutMs,
      stream: true, // Always stream for tool calls
      signal: options.abortSignal,
    });

    // ── Step 5: Record in history ──
    if (options.commandHistory) {
      options.commandHistory.add({
        command,
        cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        status: result.status,
        output: result.output,
      });
    }

    // ── Step 6: Return result for AI context ──
    return result.output;
  },
};

/**
 * Get a smart default timeout based on command patterns.
 * @param {string} command
 * @returns {number} Timeout in milliseconds
 */
function getSmartTimeout(command) {
  const lower = command.toLowerCase();

  // Long-running: builds, installs, tests
  const longRunning = [
    'npm install', 'npm ci', 'npm run build', 'npm test', 'npm run test',
    'yarn install', 'yarn build', 'yarn test',
    'pnpm install', 'pnpm build', 'pnpm test',
    'pip install', 'pip3 install',
    'cargo build', 'cargo test',
    'go build', 'go test',
    'mvn ', 'gradle ',
    'make', 'cmake',
    'docker build', 'docker-compose up',
  ];

  for (const pattern of longRunning) {
    if (lower.includes(pattern)) {
      return 300_000; // 5 minutes
    }
  }

  // Quick commands
  const quick = [
    'git status', 'git log', 'git branch', 'git diff',
    'ls ', 'dir ', 'type ', 'cat ',
    'echo ', 'pwd', 'cd ',
    'whoami', 'hostname',
    'node -v', 'npm -v', 'python --version',
  ];

  for (const pattern of quick) {
    if (lower.startsWith(pattern) || lower === pattern.trim()) {
      return 15_000; // 15 seconds
    }
  }

  // Default
  return 120_000; // 2 minutes
}
