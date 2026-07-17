import chalk from 'chalk';
import * as readline from 'readline/promises';

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

const ALWAYS_ALLOW = new Set<string>();

function isAlwaysAllowed(command: string): boolean {
  return ALWAYS_ALLOW.has(command.split(' ')[0].toLowerCase());
}

function addAlwaysAllow(command: string): void {
  ALWAYS_ALLOW.add(command.split(' ')[0].toLowerCase());
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  rl.resume();
  const answer = (await rl.question(`${question} (${hint}) `)).trim().toLowerCase();
  rl.pause();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function confirmFileWrite(rl: readline.Interface, filePath: string): Promise<boolean> {
  console.log();
  console.log(chalk.hex('#FBBF24')(`\uD83D\uDCDD File write requested: `) + chalk.hex('#E2E8F0').bold(filePath));
  console.log();
  return askYesNo(rl, chalk.hex('#FBBF24')('Apply this change?'), true);
}

export async function confirmCommand(
  rl: readline.Interface,
  command: string,
  cwd: string,
  safety: SafetyResult | null = null,
): Promise<boolean> {
  const level = safety?.level || 'normal';
  const colors = SAFETY_LEVELS[level];

  if ((level === 'normal' || level === 'elevated') && isAlwaysAllowed(command)) {
    return true;
  }

  console.log();

  if (level === 'dangerous' || level === 'elevated') {
    console.log(chalk.hex(colors.fg)(`${colors.icon} ${colors.label}: ${safety?.reason || ''}`));
    if (level === 'dangerous') {
      console.log(chalk.hex('#F87171')('  This command may cause irreversible changes.'));
    }
  }

  console.log();
  console.log(chalk.hex('#475569')('  \u250C\u2500 ') + chalk.hex('#E2E8F0').bold(`$ ${command}`));
  console.log(chalk.hex('#475569')('  \u2514\u2500 ') + chalk.dim(`cwd: ${cwd}`));

  if (safety?.warnings?.length) {
    console.log();
    for (const w of safety.warnings) {
      console.log(chalk.hex('#FBBF24')(`  \u26A0 ${w}`));
    }
  }

  console.log();

  if (level === 'dangerous') {
    return askYesNo(rl, chalk.hex('#F87171').bold('Execute this DANGEROUS command?'), false);
  }

  const { action } = await (async () => {
    console.log(chalk.hex('#38BDF8')('Execute this command?'));
    console.log(`  ${chalk.hex('#34D399')('1.')} Yes \u2014 execute once`);
    console.log(`  ${chalk.hex('#34D399')('2.')} Yes, always allow "${command.split(' ')[0]}" this session`);
    console.log(`  ${chalk.hex('#F87171')('3.')} No \u2014 skip`);
    rl.resume();
    const answer = (await rl.question(chalk.hex('#38BDF8')('Choice (1-3): '))).trim();
    rl.pause();
    return { action: answer };
  })();

  if (action === '2') {
    addAlwaysAllow(command);
    return true;
  }

  return action === '1';
}

export async function confirm(rl: readline.Interface, message: string, defaultYes = true): Promise<boolean> {
  return askYesNo(rl, message, defaultYes);
}

export async function select(
  rl: readline.Interface,
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

export async function input(rl: readline.Interface, message: string, defaultValue = ''): Promise<string> {
  const prompt = defaultValue ? `${message} (${defaultValue})` : message;
  rl.resume();
  const answer = (await rl.question(`${prompt}: `)).trim();
  rl.pause();
  return answer || defaultValue;
}
