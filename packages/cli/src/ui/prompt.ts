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
 * "Yes — execute once", "Always allow this command for current session",
 * "Always allow everything for this session" and "No — skip". The
 * everything option appears only when the caller passes `onAllowAll`.
 */
export interface ConfirmCommandOptions {
  /**
   * Called when the user picks "always allow everything for this session".
   * The caller owns that state (it is session-scoped, never persisted).
   */
  onAllowAll?: () => void;
  /** Label for the everything option, so a scoped bypass reads correctly. */
  allowAllLabel?: string;
}

export async function confirmCommand(
  command: string,
  cwd: string,
  safety: SafetyResult | null = null,
  description?: string | null,
  options?: ConfirmCommandOptions,
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

  // Offered here because this is the exact moment the user is being
  // interrupted: the answer to "I don't want to be asked this fifty more
  // times" belongs in the prompt that asks, not only in a slash command they
  // would have to know about.
  const choices = [
    { name: 'Yes — execute once', value: 'yes' },
    { name: 'Always allow this command for current session', value: 'always' },
    ...(options?.onAllowAll
      ? [{ name: options.allowAllLabel ?? 'Always allow everything for this session', value: 'allow-all' }]
      : []),
    { name: 'No — skip', value: 'no' },
  ];

  const selectedValue = await pickChoiceArrowKeys('Execute command?', choices);

  if (selectedValue === 'always') {
    addAlwaysAllow(command);
    return true;
  }
  if (selectedValue === 'allow-all') {
    options?.onAllowAll?.();
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

/**
 * askQuestions — render the `question` tool's prompts and collect answers.
 *
 * The agent asking is almost always cheaper than the agent guessing, so this is
 * deliberately lightweight: numbered options where offered, free text otherwise.
 * Answers are keyed by header (falling back to the question text) so the tool can
 * return them verbatim to the model.
 */
export async function askQuestions(
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiple?: boolean;
  }>
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (const q of questions) {
      const key = q.header ?? q.question;
      console.log();
      console.log(`  ${chalk.hex('#38BDF8')('?')} ${chalk.bold(q.question)}`);

      if (q.options?.length) {
        for (let i = 0; i < q.options.length; i++) {
          const opt = q.options[i];
          console.log(`    ${chalk.hex('#38BDF8')(`${i + 1}.`)} ${opt.label}${opt.description ? chalk.hex('#94A3B8')(` — ${opt.description}`) : ''}`);
        }
        const hint = q.multiple ? 'Enter numbers separated by commas (or free text)' : 'Enter a number (or free text)';
        const raw = (await rl.question(`  ${chalk.hex('#94A3B8')(hint + ': ')}`)).trim();

        if (q.multiple) {
          const picks = raw
            .split(',')
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((i) => i >= 0 && i < q.options!.length);
          answers[key] = picks.length
            ? picks.map((i) => q.options![i].label).join(', ')
            : raw || q.options[0].label;
        } else {
          const idx = parseInt(raw, 10) - 1;
          answers[key] = idx >= 0 && idx < q.options.length ? q.options[idx].label : raw || q.options[0].label;
        }
      } else {
        const raw = (await rl.question(`  ${chalk.hex('#94A3B8')('Answer: ')}`)).trim();
        answers[key] = raw || '(no answer given)';
      }
      console.log();
    }
  } finally {
    rl.close();
  }

  return answers;
}
