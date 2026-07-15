/**
 * Command: mycode agent
 * Full autonomous AI coding agent.
 * Reads, writes, searches, and executes commands to complete tasks.
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { configExists, getProvidersSorted, loadConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

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

  logger.header();
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Task: ${task}`);
  logger.divider();
  console.log();

  const agent = new AgentLoop(router, cwd, {
    mode: 'agent',
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: !options.noExec ? config.preferences.confirm_commands : false,
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log();
    agent.abort();
    logger.warn('Agent interrupted by user.');
    process.exit(0);
  });

  await agent.run(task);

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

  logger.header();
  console.log(chalk.hex('#7C3AED').bold('  🤖 Agent Mode'));
  console.log(chalk.dim('  The AI can read, write, search, and execute commands.'));
  console.log(chalk.dim('  File writes and commands will ask for confirmation.\n'));
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Providers: ${providers.map((p) => p.name).join(' → ')}`);
  console.log();

  const agent = new AgentLoop(router, cwd, {
    mode: 'agent',
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: config.preferences.confirm_commands,
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex('#F59E0B').bold('🤖 ❯ '),
    terminal: true,
  });

  rl.on('SIGINT', () => {
    console.log();
    logger.info('Agent stopped. Goodbye! 👋');
    rl.close();
    process.exit(0);
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/exit' || input === '/quit' || input === '/q') {
      logger.info('Goodbye! 👋');
      rl.close();
      return;
    }

    if (input === '/help') {
      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Agent Commands'));
      console.log('  /help    — Show this help');
      console.log('  /clear   — Clear conversation');
      console.log('  /status  — Provider status');
      console.log('  /exit    — Exit agent');
      console.log();
      rl.prompt();
      return;
    }

    if (input === '/clear') {
      agent.getContext().clear();
      logger.success('Conversation cleared.');
      rl.prompt();
      return;
    }

    if (input === '/status') {
      const stats = router.getStats();
      for (const stat of stats) {
        const status = stat.available
          ? chalk.hex('#34D399')('●')
          : chalk.hex('#F87171')('●');
        console.log(`  ${status} ${stat.name} — ${stat.successes} ok, ${stat.failures} errors`);
      }
      rl.prompt();
      return;
    }

    try {
      await agent.run(input);
    } catch (err) {
      logger.error(err.message);
    }

    console.log();
    rl.prompt();
  });

  await new Promise((resolve) => {
    rl.once('close', resolve);
  });
}
