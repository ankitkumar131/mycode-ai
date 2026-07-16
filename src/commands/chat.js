/**
 * Command: mycode chat
 * Interactive REPL-style conversation with the AI.
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
import { loadConfig, configExists, getProvidersSorted } from '../utils/config.js';
import { createReadlineConfirmFns } from '../ui/prompt.js';
import logger from '../utils/logger.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

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

  // Create shared command history for this session
  const commandHistory = new CommandHistory();

  // Display header
  const firstProvider = providers[0];
  const modelLabel = firstProvider ? `${firstProvider.name} (${firstProvider.model})` : '';
  logger.header(pkg.version, modelLabel);
  logger.info(`Working directory: ${cwd}`);
  logger.info(`Providers: ${providers.map((p) => p.name).join(' → ')}`);
  console.log(
    chalk.hex('#6B7280')('  Type your message and press Enter. Use /help for commands.\n')
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex('#60A5FA').bold('✦ ❯ '),
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
    // Pass command history
    commandHistory,
  });

  // Track whether we're currently processing to ignore input during processing
  let isProcessing = false;

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    if (isProcessing) {
      // Abort current agent loop (which forwards to running commands)
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
      handleSlashCommand(input, agent, rl, router, commandHistory, cwd)
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
async function handleSlashCommand(input, agent, rl, router, commandHistory, cwd) {
  const parts = input.split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Chat Commands'));
      console.log(chalk.dim('  ───────────────────────'));
      console.log('  /help             — Show this help');
      console.log('  /clear            — Clear conversation history');
      console.log('  /status           — Show provider status');
      console.log('  /providers        — List configured providers');
      console.log('  /tokens           — Show token usage');
      console.log('  /history          — Show commands executed this session');
      console.log('  /run <command>    — Execute a shell command directly');
      console.log('  /shell            — Show shell and OS info');
      console.log('  /exit             — Exit chat');
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

      // Execute directly — bypass AI, no confirmation needed
      const result = await executeCommand(command, {
        cwd,
        timeoutMs: 120_000,
        stream: true,
      });

      // Record in history
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
