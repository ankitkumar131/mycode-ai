/**
 * Command: mycode chat
 * Interactive REPL-style conversation with the AI.
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { loadConfig, configExists, getProvidersSorted } from '../utils/config.js';
import { createReadlineConfirmFns } from '../ui/prompt.js';
import logger from '../utils/logger.js';

export function registerChatCommand(program) {
  program
    .command('chat')
    .description('Start an interactive AI conversation')
    .option('-m, --message <msg>', 'Send a single message instead of starting REPL')
    .option('-y, --yes', 'Automatically apply file writes without confirmation')
    .option('--no-exec', 'Disable command execution')
    .option('--no-tools', 'Disable tool usage (pure chat)')
    .action(async (options) => {
      try {
        if (!configExists()) {
          logger.error('No providers configured. Run `mycode init` first.');
          process.exit(1);
        }

        if (options.message) {
          await singleMessage(options.message, options);
        } else {
          await startRepl(options);
        }
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });
}

/**
 * Send a single message and exit.
 */
async function singleMessage(message, options = {}) {
  const config = loadConfig();
  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const cwd = process.cwd();

  const agent = new AgentLoop(router, cwd, {
    mode: 'chat',
    enableTools: options.tools,
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: !options.noExec && config.preferences.confirm_commands,
  });
  await agent.run(message);
}

/**
 * Start the interactive REPL.
 */
async function startRepl(options) {
  const config = loadConfig();
  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const cwd = process.cwd();

  // Display header
  logger.header();
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Providers: ${providers.map((p) => p.name).join(' → ')}`);
  console.log(
    chalk.dim('  Type your message and press Enter. Use /help for commands.\n')
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex('#7C3AED').bold('❯ '),
    terminal: true,
  });

  // Create readline-based confirm functions to avoid inquirer stdin conflicts
  const rlConfirmFns = createReadlineConfirmFns(rl);

  const agent = new AgentLoop(router, cwd, {
    mode: 'chat',
    enableTools: options.tools,
    confirmWrites: !options.yes && config.preferences.confirm_writes,
    confirmCommands: !options.noExec && config.preferences.confirm_commands,
    // Pass the readline-based confirm functions
    rlConfirmFns,
  });

  // Track whether we're currently processing to ignore input during processing
  let isProcessing = false;

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    if (isProcessing) {
      // Abort current agent loop
      agent.abort();
      isProcessing = false;
      console.log();
      logger.warn('Aborted current request.');
      rl.prompt();
      return;
    }
    console.log();
    logger.info('Goodbye! 👋');
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

    // Ignore input while processing
    if (isProcessing) {
      return;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      handleSlashCommand(input, agent, rl, router)
        .then(() => rl.prompt())
        .catch((err) => {
          logger.error(err.message);
          rl.prompt();
        });
      return;
    }

    // Process the message — pause readline to prevent stdin conflicts
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

  // Keep the process alive until readline is closed
  await new Promise((resolve) => {
    rl.once('close', resolve);
  });
}

/**
 * Handle REPL slash commands.
 */
async function handleSlashCommand(input, agent, rl, router) {
  const parts = input.split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Chat Commands'));
      console.log(chalk.dim('  ───────────────────────'));
      console.log('  /help       — Show this help');
      console.log('  /clear      — Clear conversation history');
      console.log('  /status     — Show provider status');
      console.log('  /providers  — List configured providers');
      console.log('  /tokens     — Show token usage');
      console.log('  /exit       — Exit chat');
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
          ? chalk.hex('#34D399')('● online')
          : chalk.hex('#F87171')('● offline');
        console.log(
          `  ${status} ${chalk.bold(stat.name)} (${stat.model}) — ` +
          chalk.dim(`${stat.successes} ok, ${stat.failures} errors`)
        );
      }
      console.log();
      break;

    case '/providers':
      console.log();
      const providerStats = router.getStats();
      for (const p of providerStats) {
        console.log(
          `  #${p.priority} ${chalk.bold(p.name)} — ${p.model}`
        );
      }
      console.log();
      break;

    case '/tokens':
      const ctx = agent.getContext();
      logger.info(
        `Messages: ${ctx.getMessageCount()} | Estimated tokens: ~${ctx.getTokenCount().toLocaleString()}`
      );
      break;

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
