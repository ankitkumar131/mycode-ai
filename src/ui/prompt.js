/**
 * Confirmation Prompts
 * Interactive confirmation dialogs for file writes and command execution.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { renderDiff } from './renderer.js';

/**
 * Ask for confirmation before writing a file.
 * @param {string} filePath - Path to the file being written
 * @param {string} diffText - Optional diff showing changes
 * @returns {Promise<boolean>} Whether the user confirmed
 */
export async function confirmFileWrite(filePath, diffText = null) {
  console.log();
  console.log(
    chalk.hex('#FBBF24')('📝 File write requested: ') +
    chalk.hex('#E2E8F0').bold(filePath)
  );

  if (diffText) {
    console.log(chalk.dim('Changes:'));
    renderDiff(diffText);
  }

  console.log();
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: chalk.hex('#FBBF24')('Apply this change?'),
      default: true,
    },
  ]);

  return confirmed;
}

/**
 * Ask for confirmation before executing a shell command.
 * @param {string} command - The command to execute
 * @param {string} cwd - Working directory
 * @returns {Promise<boolean>} Whether the user confirmed
 */
export async function confirmCommand(command, cwd) {
  console.log();
  console.log(
    chalk.hex('#F87171')('⚠ Command execution requested:')
  );
  console.log(
    chalk.hex('#1E293B').bgHex('#E2E8F0')(` $ ${command} `)
  );
  console.log(chalk.dim(`  in: ${cwd}`));
  console.log();

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: chalk.hex('#F87171')('Execute this command?'),
      default: false, // Default to NO for safety
    },
  ]);

  return confirmed;
}

/**
 * Ask for confirmation with a custom message.
 * @param {string} message - The question
 * @param {boolean} defaultYes - Default answer
 * @returns {Promise<boolean>}
 */
export async function confirm(message, defaultYes = true) {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultYes,
    },
  ]);
  return confirmed;
}

/**
 * Multi-choice selection.
 * @param {string} message - The question
 * @param {Array<{name, value}>} choices - Options
 * @returns {Promise<*>} Selected value
 */
export async function select(message, choices) {
  const { selection } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selection',
      message,
      choices,
    },
  ]);
  return selection;
}

/**
 * Text input.
 * @param {string} message - The question
 * @param {string} defaultValue - Default answer
 * @returns {Promise<string>}
 */
export async function input(message, defaultValue = '') {
  const { value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);
  return value;
}

/**
 * Password/secret input (masked).
 * @param {string} message - The question
 * @returns {Promise<string>}
 */
export async function password(message) {
  const { value } = await inquirer.prompt([
    {
      type: 'password',
      name: 'value',
      message,
      mask: '•',
    },
  ]);
  return value;
}
