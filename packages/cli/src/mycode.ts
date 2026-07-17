#!/usr/bin/env node
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';

const [, , cmd, ...args] = process.argv;

async function main() {
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
    case '--help':
    case '-h':
      console.log(`Usage: mycode <command>

Commands:
  init          Setup configuration
  config        Manage providers
  chat          Start interactive chat
  --help, -h    Show this help`);
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
