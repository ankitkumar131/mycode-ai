/**
 * Command Executor — Spawn-Based Async Command Engine
 *
 * Replaces execSync with child_process.spawn for:
 * - Real-time stdout/stderr streaming
 * - Configurable timeouts
 * - Ctrl+C forwarding via tree-kill
 * - Proper exit code and signal handling
 * - Output buffering with truncation for AI context
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { platform } from 'os';
import treeKill from 'tree-kill';
import { createCommandOutput } from '../ui/command-output.js';

/**
 * @typedef {object} ExecutionResult
 * @property {number|null} exitCode — Process exit code (null if killed)
 * @property {string|null} signal — Signal that killed the process (e.g., 'SIGTERM')
 * @property {string} stdout — Captured stdout (may be truncated)
 * @property {string} stderr — Captured stderr (may be truncated)
 * @property {string} output — Combined stdout + stderr for AI context
 * @property {number} durationMs — Execution duration in milliseconds
 * @property {boolean} timedOut — Whether the command was killed due to timeout
 * @property {boolean} killed — Whether the command was manually killed (Ctrl+C)
 * @property {boolean} truncated — Whether output was truncated
 * @property {string} status — 'success' | 'failed' | 'killed' | 'timeout'
 */

const MAX_OUTPUT_BYTES = 30 * 1024; // 30KB max for AI context
const DEFAULT_TIMEOUT_MS = 120_000; // 120 seconds

/**
 * Execute a command with real-time streaming and full lifecycle management.
 *
 * @param {string} command — The shell command to execute
 * @param {object} options
 * @param {string} [options.cwd] — Working directory (defaults to process.cwd())
 * @param {number} [options.timeoutMs=120000] — Timeout in ms (0 = no timeout)
 * @param {boolean} [options.stream=true] — Whether to stream output to terminal
 * @param {AbortSignal} [options.signal] — AbortSignal for external cancellation
 * @returns {Promise<ExecutionResult>}
 */
export async function executeCommand(command, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shouldStream = options.stream !== false;

  // Validate working directory
  if (!existsSync(cwd)) {
    return {
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: `Working directory does not exist: ${cwd}`,
      output: `Error: Working directory does not exist: ${cwd}`,
      durationMs: 0,
      timedOut: false,
      killed: false,
      truncated: false,
      status: 'failed',
    };
  }

  // Determine shell based on OS
  const isWindows = platform() === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

  // Create output renderer
  const outputUI = shouldStream ? createCommandOutput(command, cwd) : null;

  // Buffers
  let stdoutBuf = '';
  let stderrBuf = '';
  let combinedBuf = '';
  let truncated = false;
  let timedOut = false;
  let killed = false;

  const startTime = Date.now();

  return new Promise((resolvePromise) => {
    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Don't use shell option here — we're already using the shell directly
    });

    // Start the output UI
    if (outputUI) {
      outputUI.start();
    }

    // ── Timeout handling ──
    let timeoutHandle = null;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killProcess(child.pid);
      }, timeoutMs);
    }

    // ── External abort (Ctrl+C from agent) ──
    if (options.signal) {
      const onAbort = () => {
        killed = true;
        killProcess(child.pid);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    // ── stdout streaming ──
    let stdoutLineBuffer = '';
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuf += text;

      // Buffer for AI context (with truncation)
      if (combinedBuf.length < MAX_OUTPUT_BYTES) {
        combinedBuf += text;
        if (combinedBuf.length > MAX_OUTPUT_BYTES) {
          truncated = true;
        }
      }

      if (outputUI) {
        // Line-by-line streaming
        stdoutLineBuffer += text;
        const lines = stdoutLineBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stdoutLineBuffer = lines.pop() || '';
        for (const line of lines) {
          outputUI.writeStdout(line);
        }
      }
    });

    // ── stderr streaming ──
    let stderrLineBuffer = '';
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuf += text;

      if (combinedBuf.length < MAX_OUTPUT_BYTES) {
        combinedBuf += text;
        if (combinedBuf.length > MAX_OUTPUT_BYTES) {
          truncated = true;
        }
      }

      if (outputUI) {
        stderrLineBuffer += text;
        const lines = stderrLineBuffer.split('\n');
        stderrLineBuffer = lines.pop() || '';
        for (const line of lines) {
          outputUI.writeStderr(line);
        }
      }
    });

    // ── Process exit ──
    child.on('close', (exitCode, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const durationMs = Date.now() - startTime;

      // Flush any remaining line buffer content
      if (outputUI) {
        if (stdoutLineBuffer) outputUI.writeStdout(stdoutLineBuffer);
        if (stderrLineBuffer) outputUI.writeStderr(stderrLineBuffer);
      }

      // Determine status
      let status;
      if (timedOut) {
        status = 'timeout';
      } else if (killed) {
        status = 'killed';
      } else if (exitCode === 0) {
        status = 'success';
      } else {
        status = 'failed';
      }

      // Build the AI context output
      let output;
      if (truncated) {
        const head = combinedBuf.slice(0, Math.floor(MAX_OUTPUT_BYTES * 0.7));
        const tail = combinedBuf.slice(-Math.floor(MAX_OUTPUT_BYTES * 0.25));
        output = `$ ${command}\n${'─'.repeat(40)}\n${head}\n\n... [output truncated — ${stdoutBuf.length + stderrBuf.length} bytes total] ...\n\n${tail}`;
      } else if (combinedBuf.trim()) {
        output = `$ ${command}\n${'─'.repeat(40)}\n${combinedBuf.trim()}`;
      } else {
        output = `$ ${command}\n${'─'.repeat(40)}\n(no output)`;
      }

      // Add exit info
      if (timedOut) {
        output += `\n\n⏱ Command timed out after ${timeoutMs / 1000}s`;
      } else if (killed) {
        output += `\n\n⚡ Command killed by user`;
      } else if (exitCode !== 0) {
        output += `\n\n✖ Exited with code ${exitCode}`;
      } else {
        output += `\n\n✔ Completed successfully`;
      }

      output += ` (${formatDuration(durationMs)})`;

      // Show the output footer
      if (outputUI) {
        outputUI.finish({ exitCode, signal, durationMs, timedOut, killed });
      }

      resolvePromise({
        exitCode,
        signal: signal || null,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        output,
        durationMs,
        timedOut,
        killed,
        truncated,
        status,
      });
    });

    // ── Process error (e.g., command not found) ──
    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const durationMs = Date.now() - startTime;
      const output = `$ ${command}\n${'─'.repeat(40)}\nError: ${err.message}`;

      if (outputUI) {
        outputUI.writeStderr(err.message);
        outputUI.finish({ exitCode: 1, signal: null, durationMs, timedOut: false, killed: false });
      }

      resolvePromise({
        exitCode: 1,
        signal: null,
        stdout: stdoutBuf,
        stderr: err.message,
        output,
        durationMs,
        timedOut: false,
        killed: false,
        truncated: false,
        status: 'failed',
      });
    });
  });
}

/**
 * Kill a process tree.
 * @param {number} pid
 */
function killProcess(pid) {
  if (!pid) return;
  try {
    treeKill(pid, 'SIGTERM');
  } catch {
    // Process may already be dead
    try {
      treeKill(pid, 'SIGKILL');
    } catch {
      // Nothing more we can do
    }
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
