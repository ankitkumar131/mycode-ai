/**
 * Command Output Renderer
 * Real-time terminal UI for streaming command output.
 * Shows a bordered box with command header, live output, and exit status footer.
 */

import chalk from 'chalk';

// ── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  border: '#475569',
  header: '#38BDF8',
  headerBg: '#0F172A',
  stdout: '#CBD5E1',
  stderr: '#FB923C',
  stderrLabel: '#F87171',
  success: '#34D399',
  failure: '#F87171',
  dim: '#64748B',
  time: '#A78BFA',
};

/**
 * Create a command output renderer for real-time streaming.
 * @param {string} command - The command being executed
 * @param {string} cwd - Working directory
 * @returns {CommandOutputRenderer}
 */
export function createCommandOutput(command, cwd) {
  return new CommandOutputRenderer(command, cwd);
}

class CommandOutputRenderer {
  constructor(command, cwd) {
    this.command = command;
    this.cwd = cwd;
    this._lineCount = 0;
    this._started = false;
    this._startTime = null;
    this._timerInterval = null;
    this._lastTimerLine = '';
    this._maxDisplayLines = 200;
    this._truncatedLines = 0;
  }

  /**
   * Print the command header box.
   */
  start() {
    this._started = true;
    this._startTime = Date.now();

    console.log();
    console.log(
      chalk.hex(COLORS.border)('  ┌─') +
      chalk.hex(COLORS.header).bold(' $ ') +
      chalk.hex(COLORS.header)(this.command) +
      chalk.hex(COLORS.border)(' ─')
    );
    console.log(
      chalk.hex(COLORS.border)('  │ ') +
      chalk.hex(COLORS.dim)(`cwd: ${this.cwd}`)
    );
    console.log(chalk.hex(COLORS.border)('  │'));
  }

  /**
   * Write a stdout line.
   * @param {string} line
   */
  writeStdout(line) {
    this._lineCount++;

    if (this._lineCount <= this._maxDisplayLines) {
      console.log(
        chalk.hex(COLORS.border)('  │ ') +
        chalk.hex(COLORS.stdout)(line)
      );
    } else {
      this._truncatedLines++;
    }
  }

  /**
   * Write a stderr line.
   * @param {string} line
   */
  writeStderr(line) {
    this._lineCount++;

    if (this._lineCount <= this._maxDisplayLines) {
      console.log(
        chalk.hex(COLORS.border)('  │ ') +
        chalk.hex(COLORS.stderrLabel)('⚠ ') +
        chalk.hex(COLORS.stderr)(line)
      );
    } else {
      this._truncatedLines++;
    }
  }

  /**
   * Print the exit footer and close the box.
   * @param {object} result
   * @param {number|null} result.exitCode
   * @param {string|null} result.signal
   * @param {number} result.durationMs
   * @param {boolean} result.timedOut
   * @param {boolean} result.killed
   */
  finish(result) {
    const duration = this._formatDuration(result.durationMs);

    // Show truncation notice if needed
    if (this._truncatedLines > 0) {
      console.log(
        chalk.hex(COLORS.border)('  │ ') +
        chalk.hex(COLORS.dim)(`... ${this._truncatedLines} more lines (output truncated for display)`)
      );
    }

    console.log(chalk.hex(COLORS.border)('  │'));

    if (result.timedOut) {
      console.log(
        chalk.hex(COLORS.border)('  └─') +
        chalk.hex(COLORS.failure).bold(' ⏱ TIMEOUT ') +
        chalk.hex(COLORS.dim)(`after ${duration}`) +
        chalk.hex(COLORS.border)(' ─')
      );
    } else if (result.killed) {
      console.log(
        chalk.hex(COLORS.border)('  └─') +
        chalk.hex(COLORS.failure).bold(` ⚡ KILLED (${result.signal || 'SIGTERM'}) `) +
        chalk.hex(COLORS.dim)(`after ${duration}`) +
        chalk.hex(COLORS.border)(' ─')
      );
    } else if (result.exitCode === 0) {
      console.log(
        chalk.hex(COLORS.border)('  └─') +
        chalk.hex(COLORS.success).bold(' ✔ exit 0 ') +
        chalk.hex(COLORS.dim)(`in ${duration}`) +
        chalk.hex(COLORS.border)(' ─')
      );
    } else {
      console.log(
        chalk.hex(COLORS.border)('  └─') +
        chalk.hex(COLORS.failure).bold(` ✖ exit ${result.exitCode ?? '?'} `) +
        chalk.hex(COLORS.dim)(`in ${duration}`) +
        chalk.hex(COLORS.border)(' ─')
      );
    }

    console.log();
  }

  // ── Private ──

  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
}

/**
 * Print a compact inline result for non-streaming mode (when used in agent context
 * and the output is sent back to the AI without streaming to terminal).
 * @param {string} command
 * @param {object} result
 * @param {number|null} result.exitCode
 * @param {number} result.durationMs
 * @param {string} result.output
 */
export function printCompactResult(command, result) {
  const duration = result.durationMs < 1000
    ? `${result.durationMs}ms`
    : `${(result.durationMs / 1000).toFixed(1)}s`;

  if (result.exitCode === 0) {
    console.log(
      chalk.hex(COLORS.success)('  ✔ ') +
      chalk.hex(COLORS.dim)(`$ ${command}`) +
      chalk.hex(COLORS.dim)(` — ${duration}`)
    );
  } else {
    console.log(
      chalk.hex(COLORS.failure)('  ✖ ') +
      chalk.hex(COLORS.dim)(`$ ${command}`) +
      chalk.hex(COLORS.failure)(` — exit ${result.exitCode ?? '?'}`) +
      chalk.hex(COLORS.dim)(` — ${duration}`)
    );
  }
}
