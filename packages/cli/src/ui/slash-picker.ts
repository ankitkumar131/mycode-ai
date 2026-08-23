import chalk from 'chalk';
import readline from 'readline';
import { theme, sectionHeader } from './themes/theme.js';
import { COMMANDS } from '../commands/slash-commands.js';

export interface SlashCommandChoice {
  name: string;
  description: string;
  usage?: string;
}

export async function pickSlashCommandInteractive(initialQuery = '/'): Promise<string | undefined> {
  const query = initialQuery.toLowerCase();
  const matches = COMMANDS.filter((c) =>
    c.name.toLowerCase().startsWith(query) ||
    c.aliases?.some((a) => a.toLowerCase().startsWith(query))
  );

  if (matches.length === 0) {
    return undefined;
  }

  if (!process.stdin.isTTY) {
    return matches[0].name;
  }

  let selectedIndex = 0;
  let renderedLines = 0;

  return new Promise<string | undefined>((resolve) => {
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

      lines.push('');
      lines.push(sectionHeader('Slash Commands', { accent: 'green' }));
      lines.push(`  ${chalk.hex(theme.dim)('Use ↑/↓ to select, Enter to accept, Esc to cancel')}`);
      lines.push('');

      const maxDisplay = Math.min(matches.length, 10);
      const startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(maxDisplay / 2), matches.length - maxDisplay));
      const visible = matches.slice(startIdx, startIdx + maxDisplay);

      visible.forEach((cmd, idx) => {
        const actualIdx = startIdx + idx;
        const isSelected = actualIdx === selectedIndex;
        const prefix = isSelected ? chalk.hex(theme.green).bold(' ❯ ') : '   ';
        const nameStr = isSelected
          ? chalk.bgHex(theme.green).hex(theme.black).bold(` ${cmd.name} `)
          : chalk.hex(theme.green).bold(cmd.name);
        const descStr = chalk.hex(theme.muted)(cmd.description);

        lines.push(`${prefix}${nameStr}  ${descStr}`);
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
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % matches.length;
        render();
      } else if (key.name === 'return' || key.name === 'tab') {
        cleanup();
        resolve(matches[selectedIndex].name);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(undefined);
      }
    };

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
    };

    stdin.on('keypress', onKeypress);
  });
}
