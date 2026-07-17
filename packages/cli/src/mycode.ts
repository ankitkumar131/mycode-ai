#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { explainCommand } from './commands/explain.js';
import { fixCommand } from './commands/fix.js';
import { editCommand } from './commands/edit.js';
import { agentCommand } from './commands/agent.js';
import chalk from 'chalk';

const [, , cmd, ...args] = process.argv;

async function checkForUpdate(): Promise<void> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const pkgName = pkg.name;
    const localVersion = pkg.version;
    const res = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as { version?: string };
      if (data.version && data.version !== localVersion) {
        const title = `Update available: ${chalk.dim(localVersion)} \u2192 ${chalk.green(data.version)}`;
        const command = `npm install -g ${pkgName}`;
        const cmdText = `Run ${chalk.cyan(command)} to update`;

        const line1 = `Update available: ${localVersion} \u2192 ${data.version}`;
        const line2 = `Run ${command} to update`;
        const padding = 4;
        const contentWidth = Math.max(line1.length, line2.length);
        const boxWidth = contentWidth + padding * 2;

        const borderTop = '┌' + '─'.repeat(boxWidth) + '┐';
        const borderBottom = '└' + '─'.repeat(boxWidth) + '┘';
        const emptyLine = '│' + ' '.repeat(boxWidth) + '│';

        const padLine = (textWithAnsi: string, plainTextLength: number) => {
          const leftPad = padding;
          const rightPad = boxWidth - leftPad - plainTextLength;
          return '│' + ' '.repeat(leftPad) + textWithAnsi + ' '.repeat(rightPad) + '│';
        };

        console.error('\n' + chalk.yellow(borderTop));
        console.error(chalk.yellow(emptyLine));
        console.error(chalk.yellow(padLine(title, line1.length)));
        console.error(chalk.yellow(padLine(cmdText, line2.length)));
        console.error(chalk.yellow(emptyLine));
        console.error(chalk.yellow(borderBottom) + '\n');
      }
    }
  } catch {
    // offline or registry unreachable
  }
}

async function main() {
  await checkForUpdate();
  switch (cmd) {
    case 'init':
      await initCommand();
      break;
    case 'config':
      await configCommand(args[0], ...args.slice(1));
      break;
    case 'chat':
    case undefined:
      await chatCommand();
      break;
    case 'explain':
      await explainCommand(args[0]);
      break;
    case 'fix':
      await fixCommand(args[0]);
      break;
    case 'edit':
      await editCommand(args[0], args.slice(1).join(' '));
      break;
    case 'agent':
      await agentCommand(args.join(' '));
      break;
    case '--help':
    case '-h':
      console.log(`Usage: mycode <command>

Commands:
  init              Setup configuration
  config            Manage providers
  chat              Start interactive chat
  explain <file>    Get AI explanation of a file
  fix <file|error>  Diagnose and fix errors
  edit <file> ...   Edit a file with AI
  agent [task]      Full autonomous coding agent
  --help, -h        Show this help`);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(`Run 'mycode --help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
