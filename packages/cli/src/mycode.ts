#!/usr/bin/env node
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { explainCommand } from './commands/explain.js';
import { fixCommand } from './commands/fix.js';
import { editCommand } from './commands/edit.js';
import { agentCommand } from './commands/agent.js';
import { checkForUpdate, getLocalPackageInfo } from './utils/update-check.js';

const [, , cmd, ...args] = process.argv;

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
    case '--version':
    case '-v': {
      const { name, version } = getLocalPackageInfo();
      console.log(`MyCode CLI v${version} (${name})`);
      break;
    }
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
  --version, -v     Show CLI version
  --help, -h        Show this help`);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(`Run 'mycode --help' for usage.`);
      process.exitCode = 1;
      break;
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exitCode = 1;
});
