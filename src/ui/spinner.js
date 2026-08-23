/**
 * Spinner / Loading Indicator
 * Gemini CLI-inspired: uses ✦ sparkle icon with a clean, minimal animation.
 */

import ora from 'ora';
import chalk from 'chalk';

const BRAND = {
  sparkle: '#60A5FA',
  accent: '#A78BFA',
  tool: '#38BDF8',
  dim: '#6B7280',
  warning: '#FBBF24',
};

/**
 * Create a Gemini-style thinking spinner.
 * Shows: ✦ model_name
 * @param {string} providerLabel - e.g., "gpt-4o (OpenRouter)"
 * @returns {object} Ora spinner instance
 */
export function createSpinner(providerLabel = '') {
  const label = providerLabel
    ? `${chalk.hex(BRAND.sparkle)('✦')} ${chalk.hex(BRAND.sparkle).bold(providerLabel)}`
    : `${chalk.hex(BRAND.sparkle)('✦')} ${chalk.hex(BRAND.sparkle)('Thinking...')}`;

  return ora({
    text: label,
    spinner: {
      interval: 120,
      frames: ['  ✦', '  ✧', '  ✦', '  ✧', '  ◆', '  ✦'],
    },
    color: 'blue',
    prefixText: '',
  });
}

/**
 * Create a compact spinner for tool execution.
 * Shows: ⬡ toolName
 * @param {string} toolName - Name of the tool being executed
 * @returns {object} Ora spinner instance
 */
export function createToolSpinner(toolName) {
  return ora({
    text: `${chalk.hex(BRAND.accent)('⬡')} ${chalk.hex(BRAND.accent)(toolName)}`,
    spinner: {
      interval: 100,
      frames: ['  ⬡', '  ⬢', '  ⬡', '  ⬢'],
    },
    color: 'magenta',
    prefixText: '',
  });
}

/**
 * Create a spinner for initialization tasks.
 * @param {string} message - What's happening
 * @returns {object} Ora spinner instance
 */
export function createSetupSpinner(message) {
  return ora({
    text: chalk.hex(BRAND.dim)(message),
    spinner: 'dots',
    color: 'white',
    prefixText: '  ',
  });
}

/**
 * Create a spinner for code generation (streaming tool call args).
 * @returns {object} Ora spinner instance
 */
export function createCodegenSpinner() {
  return ora({
    text: `${chalk.hex(BRAND.tool)('✦')} ${chalk.hex(BRAND.tool)('Generating...')}`,
    spinner: {
      interval: 100,
      frames: ['  ✦', '  ✧', '  ✦', '  ✧'],
    },
    color: 'cyan',
    prefixText: '',
  });
}

/**
 * Update a spinner to show provider switch.
 * @param {object} spinner - Existing spinner
 * @param {string} newProvider - New provider label
 */
export function showProviderSwitch(spinner, newProvider) {
  spinner.text = `${chalk.hex(BRAND.warning)('↻')} ${chalk.hex(BRAND.warning)(`Switching to ${chalk.bold(newProvider)}...`)}`;
  spinner.color = 'yellow';
}
