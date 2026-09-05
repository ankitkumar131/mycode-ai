#!/usr/bin/env node
process.noDeprecation = true;
import { chatCommand, type ChatOptions } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { explainCommand } from './commands/explain.js';
import { fixCommand } from './commands/fix.js';
import { editCommand } from './commands/edit.js';
import { agentCommand } from './commands/agent.js';
import { checkForUpdate, getLocalPackageInfo } from './utils/update-check.js';

const argv = process.argv.slice(2);

/** Parse chat flags: --continue/-c, --resume <id>, -q/--query <text>, --model/-m, --yolo, -Q (quiet/one-shot). */
function parseChatFlags(args: string[]): { opts: ChatOptions; rest: string[] } {
  const opts: ChatOptions = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === '--continue' || a === '-c') opts.continue = true;
    else if (a === '--resume' || a === '-r') opts.resume = next();
    else if (a.startsWith('--resume=')) opts.resume = a.slice(9);
    else if (a === '--query' || a === '-q') opts.query = next();
    else if (a === '--model' || a === '-m') opts.model = next();
    else if (a.startsWith('--model=')) opts.model = a.slice(8);
    else if (a === '--yolo' || a === '--dangerously-skip-permissions') opts.yolo = true;
    else rest.push(a);
  }
  if (!opts.query && rest.length && !opts.continue) {
    // `mycode chat "do X"` → one-shot
    opts.query = rest.join(' ');
  }
  return { opts, rest };
}

const CHAT_FLAGS = new Set(['--continue', '-c', '--resume', '-r', '--query', '-q', '--model', '-m', '--yolo']);
const first = argv[0];
const cmd = first === undefined || CHAT_FLAGS.has(first) || first.startsWith('--resume=') || first.startsWith('--model=') ? 'chat' : first;
const args = cmd === 'chat' && first !== 'chat' ? argv : argv.slice(1);

async function main() {
  await checkForUpdate();

  switch (cmd) {
    case 'init':
    case 'setup':
      await initCommand();
      break;
    case 'config':
      await configCommand(args[0], ...args.slice(1));
      break;
    case 'chat': {
      const { opts } = parseChatFlags(args);
      await chatCommand(opts);
      break;
    }
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
    case 'skills': {
      const { skillManager } = await import('@mycode/core');
      skillManager.seedBundledSkills();
      const list = skillManager.list(process.cwd());
      console.log(`\n  Skills (${list.length}) in ${skillManager.getSkillsDir()}\n`);
      for (const s of list) console.log(`  /${s.name.padEnd(30)} ${s.description}`);
      console.log();
      break;
    }
    case 'sessions': {
      const { sessionStore } = await import('@mycode/core');
      const list = sessionStore.list(30);
      if (!list.length) console.log('\n  No saved sessions.\n');
      for (const s of list) console.log(`  ${s.id}  ${s.updatedAt.slice(0, 16).replace('T', ' ')}  ${(s.title ?? '').padEnd(24)} ${s.firstPrompt.slice(0, 60)}`);
      console.log();
      break;
    }
    case 'doctor': {
      const { ConfigManager, skillManager } = await import('@mycode/core');
      const cm = new ConfigManager();
      const cfg = cm.configExists() ? await cm.load() : cm.get();
      console.log(`\n  Node:      ${process.version}`);
      console.log(`  Config:    ${cm.getConfigPath()} ${cm.configExists() ? '✓' : '✗ (run mycode init)'}`);
      console.log(`  Providers: ${cfg.providers.length ? cfg.providers.map(p => p.name).join(', ') : 'none'}`);
      console.log(`  Skills:    ${skillManager.list(process.cwd()).length} in ${skillManager.getSkillsDir()}`);
      console.log(`  Editor:    ${process.env.VISUAL || process.env.EDITOR || '(unset — Ctrl+G uses vi/notepad)'}`);
      console.log(`  TTY:       ${process.stdout.isTTY ? 'yes' : 'no'}  TERM=${process.env.TERM ?? ''}  ${process.env.TERM_PROGRAM ?? ''}\n`);
      break;
    }
    case '--version':
    case '-v': {
      const { name, version } = getLocalPackageInfo();
      console.log(`MyCode CLI v${version} (${name})`);
      break;
    }
    case '--help':
    case '-h':
      console.log(`Usage: mycode [command] [options]

Commands:
  chat [flags] [query]   Start interactive chat (default)
      -c, --continue         Resume the latest session for this directory
      -r, --resume <id>      Resume a saved session by id or title
      -q, --query <text>     Run a single query and exit
      -m, --model <name>     Use a specific configured provider/model
      --yolo                 Skip approval prompts
  init | setup           Setup configuration
  config                 Manage providers
  skills                 List installed skills
  sessions               List saved sessions
  doctor                 Environment check
  explain <file>         Get AI explanation of a file
  fix <file|error>       Diagnose and fix errors
  edit <file> ...        Edit a file with AI
  agent [task]           Full autonomous coding agent
  --version, -v          Show CLI version
  --help, -h             Show this help

Inside chat: type / for commands, !cmd for shell, @file to attach, Ctrl+Enter for a new line.`);
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
