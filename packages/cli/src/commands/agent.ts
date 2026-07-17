import { createInterface } from 'readline/promises';
import { ConfigManager, AgentSession, ProviderRouter, ToolCall, ToolResult, type SafetyResult } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { confirmCommand } from '../ui/prompt.js';
import { Ora } from 'ora';

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
    onToolCall(toolCall: ToolCall) {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      if (toolCall.name !== 'exec-command') {
        currentSpinner = createToolSpinner(toolCall.name);
        currentSpinner.start();
      }
    },
    onToolResult(result: ToolResult) {
      if (currentSpinner) {
        currentSpinner.succeed(chalk.dim(result.toolName));
        currentSpinner = null;
      }
    },
    onError(error: Error) {
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(error.message));
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
      console.log(renderMarkdown(result));
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

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.cyan('\nAgent Mode \u2014 /exit to quit\n'));

  while (true) {
    const input = await rl.question(chalk.magenta('agent> '));
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
      console.log(renderMarkdown(result));
    } catch (err: any) {
      if (currentSpinner) {
        currentSpinner.fail(chalk.red(err.message));
        currentSpinner = null;
      } else {
        console.error(chalk.red('\nError:'), err.message);
      }
    }
  }

  rl.close();
}
