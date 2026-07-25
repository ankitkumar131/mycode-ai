import chalk from 'chalk';
import readline from 'readline';
import { theme, heavyDivider, sectionHeader } from './themes/theme.js';
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

  let selectedIndex = 0;

  return new Promise<string | undefined>((resolve) => {
    const stdin = process.stdin;
    const isRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();

    const render = () => {
      // Move cursor up and clear lines if rendering repeatedly
      console.log();
      console.log(sectionHeader('Slash Commands', { accent: 'green' }));
      console.log(`  ${chalk.hex(theme.dim)('Use ↑/↓ arrow keys to select, Enter/Tab to accept, Esc to cancel:')}`);
      console.log();

      const maxDisplay = 10;
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

        console.log(`${prefix}${nameStr.padEnd(24)} ${descStr}`);
      });

      console.log();
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
      stdin.setRawMode?.(isRaw ?? false);
    };

    stdin.on('keypress', onKeypress);
  });
}
