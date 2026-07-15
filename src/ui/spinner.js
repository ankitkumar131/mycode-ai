/**
 * Spinner / Loading Indicator
 * Shows which provider is being called and handles failover messaging.
 */

import ora from 'ora';
import chalk from 'chalk';

/**
 * Create a branded spinner for provider requests.
 * @param {string} providerLabel - e.g., "OpenRouter (gpt-5)"
 * @returns {object} Ora spinner instance
 */
export function createSpinner(providerLabel = '') {
  const label = providerLabel
    ? `${chalk.hex('#A78BFA')('⚡')} Thinking with ${chalk.hex('#A78BFA').bold(providerLabel)}...`
    : `${chalk.hex('#A78BFA')('⚡')} Thinking...`;

  return ora({
    text: label,
    spinner: 'dots2',
    color: 'magenta',
  });
}

/**
 * Create a spinner for tool execution.
 * @param {string} toolName - Name of the tool being executed
 * @returns {object} Ora spinner instance
 */
export function createToolSpinner(toolName) {
  return ora({
    text: `${chalk.hex('#38BDF8')('🔧')} Running ${chalk.hex('#38BDF8').bold(toolName)}...`,
    spinner: 'dots',
    color: 'cyan',
  });
}

/**
 * Create a spinner for initialization tasks.
 * @param {string} message - What's happening
 * @returns {object} Ora spinner instance
 */
export function createSetupSpinner(message) {
  return ora({
    text: chalk.dim(message),
    spinner: 'line',
    color: 'white',
  });
}

/**
 * Create a spinner for code generation (tool call argument streaming).
 * @returns {object} Ora spinner instance
 */
export function createCodegenSpinner() {
  return ora({
    text: `${chalk.hex('#38BDF8')('✍')} Generating code...`,
    spinner: 'dots2',
    color: 'cyan',
  });
}

/**
 * Update a spinner to show provider switch.
 * @param {object} spinner - Existing spinner
 * @param {string} newProvider - New provider label
 */
export function showProviderSwitch(spinner, newProvider) {
  spinner.text = `${chalk.hex('#FB923C')('↻')} Switching to ${chalk.hex('#FB923C').bold(newProvider)}...`;
  spinner.color = 'yellow';
}
