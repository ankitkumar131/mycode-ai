import * as readline from 'readline';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { Ora } from 'ora';
import { decodeEntities } from '../utils/html.js';

async function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function chatCommand(options: { model?: string; provider?: string } = {}): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  let currentSpinner: Ora | null = null;

  const session = new AgentSession({
    providerRouter: router,
    maxIterations: 25,
    onText() {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
    },
    onToolCall(toolName: string) {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      currentSpinner = createToolSpinner(toolName);
      currentSpinner.start();
    },
    onToolResult(name: string) {
      if (currentSpinner) {
        currentSpinner.succeed(chalk.dim(name));
        currentSpinner = null;
      }
    },
    onError(message: string) {
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(message));
        currentSpinner = null;
      }
    },
    onFinish() {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
    },
  });

  console.log(chalk.cyan('\nMyCode Chat \u2014 /exit to quit, /clear to clear\n'));

  while (true) {
    let input: string;
    try {
      input = await question(chalk.green('> '));
    } catch {
      break;
    }
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === '/exit' || trimmed === '/quit') break;
    if (trimmed === '/clear') {
      console.clear();
      continue;
    }

    console.log();
    currentSpinner = createSpinner();
    currentSpinner.start();

    try {
      const result = await session.run(trimmed);
      console.error('\n[DEBUG] session.run() returned:', JSON.stringify(result.slice(0, 200)));
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      console.log();
      if (result && result.trim()) {
        console.log(decodeEntities(renderMarkdown(result)));
      } else {
        console.error('[DEBUG] result was empty');
      }
    } catch (err: any) {
      console.error('\n[DEBUG] session.run() threw:', err.message);
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(err.message));
        currentSpinner = null;
      } else {
        console.error(chalk.red('\nError:'), err.message);
      }
    }
  }
}
