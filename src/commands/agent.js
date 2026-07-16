/**
 * Command: mycode agent
 * Full autonomous AI coding agent.
 * Reads, writes, searches, and executes commands to complete tasks.
 *
 * Enhanced with:
 * - /history — show commands executed this session
 * - /run <command> — execute a shell command directly (bypass AI)
 * - /shell — show current shell info
 * - CommandHistory integration
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import { platform } from 'os';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { CommandHistory } from '../tools/command-history.js';
import { executeCommand } from '../tools/command-executor.js';
import { configExists, getProvidersSorted, loadConfig } from '../utils/config.js';
import { createReadlineConfirmFns } from '../ui/prompt.js';
import logger from '../utils/logger.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

export function registerAgentCommand(program) {
  program
    .command('agent [task...]')
    .description('Start the autonomous AI agent')
    .option('-y, --yes', 'Auto-approve file writes (be careful!)')
    .option('--no-exec', 'Disable command execution')
    .action(async (task, options) => {
      try {
        if (!configExists()) {
          logger.error('No providers configured. Run `mycode init` first.');
          process.exit(1);
        }

        const taskText = task.join(' ');
        if (taskText) {
          await runAgentTask(taskText, options);
        } else {
          await startAgentRepl(options);
        }
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });
}

/**
 * Run a single agent task.
 */
async function runAgentTask(task, options) {
  const cwd = process.cwd();
  const config = loadConfig();
  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const commandHistory = new CommandHistory();

  const firstProvider = providers[0];
  const modelLabel = firstProvider ? `${firstProvider.name} (${firstProvider.model})` : '';
  logger.header(pkg.version, modelLabel);
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Task: ${task}`);
  logger.divider();
  console.log();

  const agent = new AgentLoop(router, cwd, {
    mode: 'agent',
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: !options.noExec ? config.preferences.confirm_commands : false,
    commandHistory,
  });

  // Handle Ctrl+C — forward to agent (which forwards to running commands)
  process.on('SIGINT', () => {
    console.log();
    agent.abort();
    logger.warn('Agent interrupted by user.');
    process.exit(0);
  });

  await agent.run(task);

  // Show command history summary if any commands were run
  if (commandHistory.count() > 0) {
    console.log();
    console.log(chalk.dim(commandHistory.formatSummary()));
  }

  console.log();
  logger.divider();
  logger.success('Agent task completed.');
}

/**
 * Start the agent in interactive REPL mode.
 */
async function startAgentRepl(options) {
  const cwd = process.cwd();
  const config = loadConfig();
  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const commandHistory = new CommandHistory();

  const firstProvider = providers[0];
  const modelLabel = firstProvider ? `${firstProvider.name} (${firstProvider.model})` : '';
  logger.header(pkg.version, modelLabel);
  console.log(chalk.hex('#A78BFA').bold('  🤖 Agent Mode'));
  console.log(chalk.hex('#6B7280')('  The AI can read, write, search, and execute commands.'));
  console.log(chalk.hex('#6B7280')('  File writes and commands will ask for confirmation.\n'));
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Providers: ${providers.map((p) => p.name).join(' → ')}`);
  console.log();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex('#A78BFA').bold('✦ 🤖 ❯ '),
    terminal: true,
  });

  // Create readline-based confirm functions
  const rlConfirmFns = createReadlineConfirmFns(rl);

  const agent = new AgentLoop(router, cwd, {
    mode: 'agent',
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: config.preferences.confirm_commands,
    rlConfirmFns,
    commandHistory,
  });

  let isProcessing = false;

  rl.on('SIGINT', () => {
    if (isProcessing) {
      agent.abort();
      isProcessing = false;
      console.log();
      logger.warn('Aborted current request.');
      rl.prompt();
      return;
    }
    console.log();
    logger.info('Agent stopped. Goodbye! 👋');
    rl.close();
    process.exit(0);
  });

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (isProcessing) {
      return;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      handleAgentSlashCommand(input, agent, rl, router, commandHistory, cwd)
        .then(() => rl.prompt())
        .catch((err) => {
          logger.error(err.message);
          rl.prompt();
        });
      return;
    }

    // Process the task
    isProcessing = true;
    rl.pause();

    agent
      .run(input)
      .then(() => {
        console.log();
      })
      .catch((err) => {
        logger.error(err.message);
      })
      .finally(() => {
        isProcessing = false;
        rl.resume();
        rl.prompt();
      });
  });

  await new Promise((resolve) => {
    rl.once('close', resolve);
  });
}

/**
 * Handle agent REPL slash commands.
 */
async function handleAgentSlashCommand(input, agent, rl, router, commandHistory, cwd) {
  const parts = input.split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Agent Commands'));
      console.log(chalk.dim('  ───────────────────────'));
      console.log('  /help             — Show this help');
      console.log('  /clear            — Clear conversation');
      console.log('  /status           — Provider status');
      console.log('  /history          — Show commands executed this session');
      console.log('  /run <command>    — Execute a shell command directly');
      console.log('  /shell            — Show shell and OS info');
      console.log('  /exit             — Exit agent');
      console.log();
      break;

    case '/clear':
      agent.getContext().clear();
      logger.success('Conversation cleared.');
      break;

    case '/status':
      console.log();
      const stats = router.getStats();
      for (const stat of stats) {
        const status = stat.available
          ? chalk.hex('#34D399')('●')
          : chalk.hex('#F87171')('●');
        console.log(`  ${status} ${stat.name} — ${stat.successes} ok, ${stat.failures} errors`);
      }
      console.log();
      break;

    case '/history':
      console.log();
      if (commandHistory.count() === 0) {
        logger.info('No commands executed in this session.');
      } else {
        console.log(chalk.hex('#A78BFA').bold('  Command History'));
        console.log(chalk.dim('  ───────────────────────'));
        console.log(commandHistory.formatSummary());
      }
      console.log();
      break;

    case '/run': {
      const command = parts.slice(1).join(' ');
      if (!command) {
        logger.warn('Usage: /run <command>');
        logger.info('Example: /run git status');
        break;
      }

      console.log();
      logger.info(`Running: ${chalk.bold(command)}`);

      const result = await executeCommand(command, {
        cwd,
        timeoutMs: 120_000,
        stream: true,
      });

      commandHistory.add({
        command,
        cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        status: result.status,
        output: result.output,
      });

      break;
    }

    case '/shell': {
      const isWindows = platform() === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const osLabel = isWindows ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';

      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Shell Info'));
      console.log(chalk.dim('  ───────────────────────'));
      console.log(`  OS:     ${osLabel} (${platform()})`);
      console.log(`  Shell:  ${shell}`);
      console.log(`  CWD:    ${cwd}`);

      try {
        const { execSync } = await import('child_process');
        const nodeV = execSync('node -v', { encoding: 'utf-8' }).trim();
        console.log(`  Node:   ${nodeV}`);
      } catch {
        // ignore
      }

      console.log();
      break;
    }

    case '/exit':
    case '/quit':
    case '/q':
      logger.info('Goodbye! 👋');
      rl.close();
      break;

    default:
      logger.warn(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}
