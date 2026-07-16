/**
 * Confirmation Prompts
 * Interactive confirmation dialogs for file writes and command execution.
 * Enhanced with color-coded safety banners and "always allow" session memory.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { renderDiff } from './renderer.js';
import { platform } from 'os';

// ── Session-level "always allow" memory (not persisted across runs) ──────────

const _alwaysAllowed = new Set();

/**
 * Check if a command pattern is in the "always allow" list.
 * @param {string} command
 * @returns {boolean}
 */
function isAlwaysAllowed(command) {
  const base = command.split(' ')[0].toLowerCase();
  return _alwaysAllowed.has(base) || _alwaysAllowed.has(command.toLowerCase());
}

/**
 * Add a command pattern to the "always allow" list.
 * @param {string} command
 */
function addAlwaysAllow(command) {
  const base = command.split(' ')[0].toLowerCase();
  _alwaysAllowed.add(base);
}

// ── Safety level colors and labels ──────────────────────────────────────────

const SAFETY_COLORS = {
  blocked:   { bg: '#7F1D1D', fg: '#FCA5A5', icon: '🚫', label: 'BLOCKED' },
  dangerous: { bg: '#7F1D1D', fg: '#FCA5A5', icon: '⛔', label: 'DANGEROUS' },
  elevated:  { bg: '#78350F', fg: '#FDE68A', icon: '⚠️',  label: 'ELEVATED' },
  normal:    { bg: '#1E3A5F', fg: '#93C5FD', icon: '✔',  label: 'NORMAL' },
};

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
 * Enhanced with color-coded safety banners and "always allow" option.
 *
 * @param {string} command - The command to execute
 * @param {string} cwd - Working directory
 * @param {import('../tools/command-safety.js').SafetyResult} [safety] - Safety classification
 * @returns {Promise<boolean>} Whether the user confirmed
 */
export async function confirmCommand(command, cwd, safety = null) {
  const level = safety?.level || 'normal';
  const colors = SAFETY_COLORS[level] || SAFETY_COLORS.normal;

  // Check "always allow" first (only for normal/elevated commands)
  if ((level === 'normal' || level === 'elevated') && isAlwaysAllowed(command)) {
    return true;
  }

  console.log();

  // ── Safety banner ──
  if (level === 'dangerous') {
    console.log(
      chalk.bgHex(colors.bg).hex(colors.fg).bold(` ${colors.icon} ${colors.label} `) +
      chalk.hex(colors.fg)(` ${safety.reason}`)
    );
    console.log(
      chalk.hex('#F87171')('  This command may cause irreversible changes.')
    );
  } else if (level === 'elevated') {
    console.log(
      chalk.bgHex(colors.bg).hex(colors.fg).bold(` ${colors.icon} ${colors.label} `) +
      chalk.hex(colors.fg)(` ${safety.reason}`)
    );
  }

  // ── Command display ──
  console.log();
  console.log(
    chalk.hex('#475569')('  ┌─ ') +
    chalk.hex('#E2E8F0').bold(`$ ${command}`)
  );
  console.log(
    chalk.hex('#475569')('  └─ ') +
    chalk.dim(`cwd: ${cwd}`)
  );

  // ── Warnings ──
  if (safety?.warnings?.length > 0) {
    console.log();
    for (const warning of safety.warnings) {
      console.log(chalk.hex('#FBBF24')(`  ⚠ ${warning}`));
    }
  }

  console.log();

  // ── Prompt ──
  // For dangerous commands: default to NO, no "always allow"
  if (level === 'dangerous') {
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: chalk.hex('#F87171').bold('Execute this DANGEROUS command?'),
        default: false,
      },
    ]);
    return confirmed;
  }

  // For normal/elevated: offer "always allow" option
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.hex('#38BDF8')('Execute this command?'),
      choices: [
        { name: chalk.hex('#34D399')('Yes — execute once'), value: 'yes' },
        {
          name: chalk.hex('#34D399')(`Yes, always allow "${command.split(' ')[0]}" this session`),
          value: 'always',
        },
        { name: chalk.hex('#F87171')('No — skip'), value: 'no' },
      ],
    },
  ]);

  if (action === 'always') {
    addAlwaysAllow(command);
    return true;
  }

  return action === 'yes';
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

/**
 * Create readline-based confirm functions that reuse an existing readline interface.
 * This avoids the stdin conflict that inquirer causes when used inside a chat REPL.
 * @param {import('readline').Interface} rl - The existing readline interface
 * @returns {{ confirmFileWrite: Function, confirmCommand: Function }}
 */
export function createReadlineConfirmFns(rl) {
  /**
   * Ask a yes/no question using the existing readline interface.
   * @param {string} question - The question to ask
   * @param {boolean} defaultYes - Default answer
   * @returns {Promise<boolean>}
   */
  function askYesNo(question, defaultYes = true) {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    return new Promise((resolve) => {
      rl.resume();
      rl.question(
        chalk.hex('#FBBF24')(`${question} (${hint}) `),
        (answer) => {
          rl.pause();
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === '') {
            resolve(defaultYes);
          } else {
            resolve(trimmed === 'y' || trimmed === 'yes');
          }
        }
      );
    });
  }

  async function rlConfirmFileWrite(filePath, diffText = null) {
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
    return askYesNo('Apply this change?', true);
  }

  async function rlConfirmCommand(command, cwd, safety = null) {
    const level = safety?.level || 'normal';
    const colors = SAFETY_COLORS[level] || SAFETY_COLORS.normal;

    // Check "always allow" (only for normal/elevated)
    if ((level === 'normal' || level === 'elevated') && isAlwaysAllowed(command)) {
      return true;
    }

    console.log();

    // Safety banner
    if (level === 'dangerous') {
      console.log(
        chalk.bgHex(colors.bg).hex(colors.fg).bold(` ${colors.icon} ${colors.label} `) +
        chalk.hex(colors.fg)(` ${safety.reason}`)
      );
      console.log(chalk.hex('#F87171')('  This command may cause irreversible changes.'));
    } else if (level === 'elevated') {
      console.log(
        chalk.bgHex(colors.bg).hex(colors.fg).bold(` ${colors.icon} ${colors.label} `) +
        chalk.hex(colors.fg)(` ${safety.reason}`)
      );
    }

    // Command display
    console.log();
    console.log(
      chalk.hex('#475569')('  ┌─ ') +
      chalk.hex('#E2E8F0').bold(`$ ${command}`)
    );
    console.log(
      chalk.hex('#475569')('  └─ ') +
      chalk.dim(`cwd: ${cwd}`)
    );

    // Warnings
    if (safety?.warnings?.length > 0) {
      console.log();
      for (const warning of safety.warnings) {
        console.log(chalk.hex('#FBBF24')(`  ⚠ ${warning}`));
      }
    }

    console.log();

    const defaultYes = level !== 'dangerous';
    return askYesNo('Execute this command?', defaultYes);
  }

  return {
    confirmFileWrite: rlConfirmFileWrite,
    confirmCommand: rlConfirmCommand,
  };
}
