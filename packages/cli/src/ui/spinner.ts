/**
 * Gemini CLI-style Spinners
 * ✦ ✧ ◆ sparkle animation for thinking, ⬡ ⬢ for tools.
 */

import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import { COLORS, ICONS, S } from './themes/theme.js';

export const SPINNER_FRAMES = {
  thinking: {
    interval: 120,
    frames: [
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.thinking)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.thinking)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.diamond)}`,
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
    ],
  },
  tool: {
    interval: 100,
    frames: [
      `  ${chalk.hex(COLORS.accent)(ICONS.hexEmpty)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexFull)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexEmpty)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexFull)}`,
    ],
  },
  codegen: {
    interval: 100,
    frames: [
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkleAlt)}`,
    ],
  },
};

/**
 * Create a thinking spinner with model name.
 */
export function createSpinner(providerLabel = ''): Ora {
  const label = providerLabel
    ? `${S.brand(ICONS.sparkle)} ${S.accentBold(providerLabel)}`
    : `${S.brand(ICONS.sparkle)} ${S.brand('Thinking...')}`;

  return ora({
    text: label,
    spinner: SPINNER_FRAMES.thinking,
    color: 'blue',
    prefixText: '',
  });
}

/**
 * Create a tool execution spinner.
 */
export function createToolSpinner(toolName: string): Ora {
  return ora({
    text: `${S.accent(ICONS.hexEmpty)} ${S.accent(toolName)}`,
    spinner: SPINNER_FRAMES.tool,
    color: 'magenta',
    prefixText: '',
  });
}

/**
 * Create a code generation progress spinner.
 */
export function createCodegenSpinner(): Ora {
  return ora({
    text: `${S.cyan(ICONS.sparkle)} ${S.cyan('Generating...')}`,
    spinner: SPINNER_FRAMES.codegen,
    color: 'cyan',
    prefixText: '',
  });
}

/**
 * Create a setup/initialization spinner.
 */
export function createSetupSpinner(message: string): Ora {
  return ora({
    text: S.dim(message),
    spinner: 'dots',
    color: 'white',
    prefixText: '  ',
  });
}

/**
 * Update a spinner to show provider switch notification.
 */
export function showProviderSwitch(spinner: Ora, from: string, to: string, reason: string): void {
  spinner.text = `${S.warning(ICONS.switch)} ${S.warning(`Switching ${chalk.bold(from)} → ${chalk.bold(to)}`)} ${S.dim(`(${reason})`)}`;
  spinner.color = 'yellow';
}
