import chalk from 'chalk';
import readline from 'readline';
import * as readlinePromises from 'readline/promises';

const SAFETY_LEVELS = {
  blocked: { fg: '#FCA5A5', icon: '\uD83D\uDEAB', label: 'BLOCKED' },
  dangerous: { fg: '#FCA5A5', icon: '\u26D4', label: 'DANGEROUS' },
  elevated: { fg: '#FDE68A', icon: '\u26A0\uFE0F', label: 'ELEVATED' },
  normal: { fg: '#93C5FD', icon: '\u2714', label: 'NORMAL' },
};

type SafetyLevel = keyof typeof SAFETY_LEVELS;

interface SafetyResult {
  level: SafetyLevel;
  reason?: string;
  warnings?: string[];
}

/** Commands the user approved with "Always allow this command for current session". */
const ALWAYS_ALLOW = new Set<string>();

function normalizeCommand(command: string): string {
  return command.trim().toLowerCase();
}

function isAlwaysAllowed(command: string): boolean {
  const norm = normalizeCommand(command);
  for (const entry of ALWAYS_ALLOW) {
    if (norm === entry || norm.startsWith(entry + ' ')) return true;
  }
  return false;
}

function addAlwaysAllow(command: string): void {
  ALWAYS_ALLOW.add(normalizeCommand(command));
}

async function askYesNo(rl: readlinePromises.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  rl.resume();
  const answer = (await rl.question(`${question} (${hint}) `)).trim().toLowerCase();
  rl.pause();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function confirmFileWrite(rl: readlinePromises.Interface, filePath: string): Promise<boolean> {
  console.log();
  console.log(chalk.hex('#FBBF24')(`\uD83D\uDCDD File write requested: `) + chalk.hex('#E2E8F0').bold(filePath));
  console.log();
  return askYesNo(rl, chalk.hex('#FBBF24')('Apply this change?'), true);
}

/**
 * Interactive arrow-key choice picker (like agy/gemini-cli / openclaude).
 * Uses ANSI escape codes to clear and redraw in-place.
 */
export function pickChoiceArrowKeys(
  title: string,
  choices: Array<{ name: string; value: string }>
): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.resolve(choices[0].value);
  }

  let selectedIndex = 0;
  let renderedLines = 0;

  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    const clearRendered = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A`);
        for (let i = 0; i < renderedLines; i++) {
          process.stdout.write('\x1b[2K\n');
        }
        process.stdout.write(`\x1b[${renderedLines}A`);
        renderedLines = 0;
      }
    };

    const render = () => {
      clearRendered();
      const lines: string[] = [];

      lines.push(chalk.hex('#38BDF8').bold(`  ${title}`));
      choices.forEach((choice, idx) => {
        const isSelected = idx === selectedIndex;
        if (isSelected) {
          lines.push(`  ${chalk.hex('#34D399').bold('❯')} ${chalk.bgHex('#34D399').hex('#0F172A').bold(` ${choice.name} `)}`);
        } else {
          lines.push(`    ${chalk.hex('#94A3B8')(choice.name)}`);
        }
      });
      lines.push('');

      const output = lines.join('\n');
      process.stdout.write(output);
      renderedLines = lines.length;
    };

    render();

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      } else if (key.name === 'return') {
        clearRendered();
        // Show the chosen option inline
        const chosen = choices[selectedIndex];
        process.stdout.write(`  ${chalk.hex('#34D399').bold('✔')} ${chalk.hex('#E2E8F0')(chosen.name)}\n`);
        cleanup();
        resolve(chosen.value);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        clearRendered();
        process.stdout.write(`  ${chalk.hex('#94A3B8')('✖ Cancelled')}\n`);
        cleanup();
        resolve(choices[choices.length - 1].value);
      }
    };

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
    };

    stdin.on('keypress', onKeypress);
  });
}

/**
 * Confirmation dialog shown when the agent auto-runs a command (or writes a
 * file). Mirrors gemini-cli / agy: the user picks with arrow keys between
 * "Yes — execute once", "Always allow this command for current session" and
 * "No — skip".
 */
export async function confirmCommand(
  command: string,
  cwd: string,
  safety: SafetyResult | null = null,
  description?: string | null,
): Promise<boolean> {
  if (isAlwaysAllowed(command)) return true;

  const level = safety?.level ?? 'normal';
  const colors = SAFETY_LEVELS[level] || SAFETY_LEVELS.normal;

  console.log();

  // Header chip
  if (safety) {
    console.log(`  ${chalk.hex(colors.fg)(`${colors.icon} ${colors.label}`)} ${chalk.hex('#94A3B8')(safety.reason ?? '')}`);
    if (level === 'dangerous') {
      console.log(chalk.hex('#F87171')('  This command may cause irreversible changes.'));
    }
  } else {
    console.log(`  ${chalk.hex(colors.fg)(`${colors.icon} ${colors.label}`)} ${chalk.hex('#94A3B8')('File write requested')}`);
  }

  // Command / target box
  console.log();
  const isCommand = !!safety;
  console.log(chalk.hex('#475569')('  ┌─ ') + chalk.hex('#E2E8F0').bold(`${isCommand ? '$ ' : '✍ '}${command}`));
  console.log(chalk.hex('#475569')('  └─ ') + chalk.dim(`cwd: ${cwd}`));
  if (description) {
    console.log(chalk.hex('#94A3B8')(`     ${description}`));
  }
  if (safety?.warnings?.length) {
    for (const w of safety.warnings) {
      console.log(chalk.hex('#FBBF24')(`  ⚠ ${w}`));
    }
  }
  console.log();

  const choices = [
    { name: 'Yes — execute once', value: 'yes' },
    { name: 'Always allow this command for current session', value: 'always' },
    { name: 'No — skip', value: 'no' },
  ];

  const selectedValue = await pickChoiceArrowKeys('Execute command?', choices);

  if (selectedValue === 'always') {
    addAlwaysAllow(command);
    return true;
  }

  return selectedValue === 'yes';
}

export async function confirm(rl: readlinePromises.Interface, message: string, defaultYes = true): Promise<boolean> {
  return askYesNo(rl, message, defaultYes);
}

export async function select(
  rl: readlinePromises.Interface,
  message: string,
  choices: Array<{ name: string; value: string }>,
): Promise<string> {
  console.log(`\n${message}`);
  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${i + 1}. ${choices[i].name}`);
  }
  rl.resume();
  const answer = (await rl.question(chalk.hex('#38BDF8')('Enter choice (number): '))).trim();
  rl.pause();
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < choices.length) return choices[idx].value;
  return choices[0].value;
}

export async function input(rl: readlinePromises.Interface, message: string, defaultValue = ''): Promise<string> {
  const prompt = defaultValue ? `${message} (${defaultValue})` : message;
  rl.resume();
  const answer = (await rl.question(`${prompt}: `)).trim();
  rl.pause();
  return answer || defaultValue;
}
