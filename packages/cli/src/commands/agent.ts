import * as readline from 'readline';
import { createInterface } from 'readline/promises';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { Ora } from 'ora';
import { decodeEntities } from '../utils/html.js';
import { confirmCommand } from '../ui/prompt.js';

async function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function agentCommand(task?: string): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  let currentSpinner: Ora | null = null;
  const promptRl = createInterface({ input: process.stdin, output: process.stdout });

  const session = new AgentSession({
    providerRouter: router,
    cwd: process.cwd(),
    maxIterations: 50,
    confirmFn: async (target, context, safety) => {
      return confirmCommand(promptRl, target, process.cwd(), safety as any ?? null);
    },
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
      if (toolName !== 'exec-command') {
        currentSpinner = createToolSpinner(toolName);
        currentSpinner.start();
      }
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

  if (task) {
    console.log(chalk.cyan(`Agent: ${task}\n`));
    currentSpinner = createSpinner('Working...');
    currentSpinner.start();

    try {
      const result = await session.run(task);
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      console.log();
      console.log(decodeEntities(renderMarkdown(result)));
    } catch (err: any) {
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(err.message));
        currentSpinner = null;
      } else {
        console.error(chalk.red('\nError:'), err.message);
      }
    }
    return;
  }

  console.log(chalk.cyan('\nAgent Mode \u2014 /exit to quit\n'));

  while (true) {
    let input: string;
    try {
      input = await question(chalk.magenta('agent> '));
    } catch {
      break;
    }
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === '/exit' || trimmed === '/quit') break;

    console.log();
    currentSpinner = createSpinner('Working...');
    currentSpinner.start();

    try {
      const result = await session.run(trimmed);
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      console.log();
      console.log(decodeEntities(renderMarkdown(result)));
    } catch (err: any) {
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(err.message));
        currentSpinner = null;
      } else {
        console.error(chalk.red('\nError:'), err.message);
      }
    }
  }
}
