/**
 * Command Output Renderer — Gemini CLI-style
 * Real-time bordered output box with header, live output, and exit status footer.
 */

import chalk from 'chalk';
import { COLORS, S, ICONS, formatDuration } from './themes/theme.js';

/**
 * Create a command output renderer for real-time streaming.
 */
export function createCommandOutput(command: string, cwd: string): CommandOutputRenderer {
  return new CommandOutputRenderer(command, cwd);
}

export class CommandOutputRenderer {
  private command: string;
  private cwd: string;
  private lineCount = 0;
  private started = false;
  private startTime: number | null = null;
  private maxDisplayLines = 200;
  private truncatedLines = 0;

  constructor(command: string, cwd: string) {
    this.command = command;
    this.cwd = cwd;
  }

  /**
   * Print the command header box.
   */
  start(): void {
    this.started = true;
    this.startTime = Date.now();

    const b = chalk.hex(COLORS.textDim);
    console.log();
    console.log(
      `${b('  ' + ICONS.corner.topLeft + ICONS.dash)}` +
      `${S.cyanBold(' $ ')}` +
      `${S.cyan(this.command)}` +
      `${b(' ' + ICONS.dash)}`
    );
    console.log(`${b('  ' + ICONS.bar + ' ')}${S.dim(`cwd: ${this.cwd}`)}`);
    console.log(`${b('  ' + ICONS.bar)}`);
  }

  /**
   * Write a stdout line.
   */
  writeStdout(line: string): void {
    this.lineCount++;
    if (this.lineCount <= this.maxDisplayLines) {
      const b = chalk.hex(COLORS.textDim);
      console.log(`${b('  ' + ICONS.bar + ' ')}${chalk.hex(COLORS.text)(line)}`);
    } else {
      this.truncatedLines++;
    }
  }

  /**
   * Write a stderr line.
   */
  writeStderr(line: string): void {
    this.lineCount++;
    if (this.lineCount <= this.maxDisplayLines) {
      const b = chalk.hex(COLORS.textDim);
      console.log(
        `${b('  ' + ICONS.bar + ' ')}${chalk.hex(COLORS.error)(ICONS.warning + ' ')}${chalk.hex(COLORS.accentGold)(line)}`
      );
    } else {
      this.truncatedLines++;
    }
  }

  /**
   * Print the exit footer and close the box.
   */
  finish(result: {
    exitCode: number | null;
    signal?: string | null;
    durationMs: number;
    timedOut?: boolean;
    killed?: boolean;
  }): void {
    const duration = formatDuration(result.durationMs);
    const b = chalk.hex(COLORS.textDim);

    // Truncation notice
    if (this.truncatedLines > 0) {
      console.log(
        `${b('  ' + ICONS.bar + ' ')}${S.dim(`... ${this.truncatedLines} more lines (truncated)`)}`
      );
    }

    console.log(`${b('  ' + ICONS.bar)}`);

    if (result.timedOut) {
      console.log(
        `${b('  ' + ICONS.corner.bottomLeft + ICONS.dash)}` +
        `${S.errorBold(' ⏱ TIMEOUT ')}` +
        `${S.dim(`after ${duration}`)}` +
        `${b(' ' + ICONS.dash)}`
      );
    } else if (result.killed) {
      console.log(
        `${b('  ' + ICONS.corner.bottomLeft + ICONS.dash)}` +
        `${S.errorBold(` ⚡ KILLED (${result.signal || 'SIGTERM'}) `)}` +
        `${S.dim(`after ${duration}`)}` +
        `${b(' ' + ICONS.dash)}`
      );
    } else if (result.exitCode === 0) {
      console.log(
        `${b('  ' + ICONS.corner.bottomLeft + ICONS.dash)}` +
        `${S.successBold(` ${ICONS.check} exit 0 `)}` +
        `${S.dim(`in ${duration}`)}` +
        `${b(' ' + ICONS.dash)}`
      );
    } else {
      console.log(
        `${b('  ' + ICONS.corner.bottomLeft + ICONS.dash)}` +
        `${S.errorBold(` ${ICONS.cross} exit ${result.exitCode ?? '?'} `)}` +
        `${S.dim(`in ${duration}`)}` +
        `${b(' ' + ICONS.dash)}`
      );
    }

    console.log();
  }
}

/**
 * Print a compact inline result for non-streaming commands.
 */
export function printCompactResult(command: string, result: {
  exitCode: number | null;
  durationMs: number;
}): void {
  const duration = formatDuration(result.durationMs);

  if (result.exitCode === 0) {
    console.log(`${S.success('  ' + ICONS.check + ' ')}${S.dim(`$ ${command}`)}${S.dim(` — ${duration}`)}`);
  } else {
    console.log(
      `${S.error('  ' + ICONS.cross + ' ')}${S.dim(`$ ${command}`)}` +
      `${S.error(` — exit ${result.exitCode ?? '?'}`)}${S.dim(` — ${duration}`)}`
    );
  }
}
