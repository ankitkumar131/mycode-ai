import { createInterface } from 'readline/promises';
import {
  ConfigManager,
  AgentSession,
  ProviderRouter,
  FailoverCoordinator,
  SubAgentRunner,
  renderSubAgentResult,
  todoStore,
  sessionStore,
} from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { Ora } from 'ora';
import { decodeEntities } from '../utils/html.js';
import { confirmCommand, askQuestions } from '../ui/prompt.js';
import { renderTodoPanel } from '../ui/todo-view.js';
import { theme } from '../ui/themes/theme.js';

async function question(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

export interface AgentCommandOptions {
  /** Skip confirmation prompts for writes and commands. */
  yolo?: boolean;
}

export async function agentCommand(task?: string, opts: AgentCommandOptions = {}): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  const cwd = process.cwd();
  let currentSpinner: Ora | null = null;
  // eslint-disable-next-line prefer-const
  let sessionRef: AgentSession | undefined;
  let streaming = false;

  const stopSpinner = () => {
    if (currentSpinner) {
      currentSpinner.stop();
      currentSpinner = null;
    }
  };

  const failover = new FailoverCoordinator({
    providers: cfg.providers,
    onAnnounce: (event) => {
      stopSpinner();
      console.log();
      console.log(
        `  ${chalk.hex(theme.switch)('↻')} ${chalk.hex(theme.warning).bold('Provider failover')}  ` +
          `${chalk.hex(theme.textSecondary)(event.from)} ${chalk.hex(theme.textDim)('→')} ` +
          `${chalk.hex(theme.brand).bold(event.to)}  ${chalk.hex(theme.textDim)(event.reason)}`
      );
      console.log(`  ${chalk.hex(theme.textDim)('Context preserved and checkpointed; continuing from where it left off.')}`);
      console.log();
    },
    onCheckpoint: () => {
      try {
        const json = sessionRef && sessionRef.toJSON();
        if (!json) return;
        sessionStore.save({
          id: json.id,
          title: json.title,
          cwd: json.cwd,
          createdAt: json.createdAt,
          updatedAt: new Date().toISOString(),
          model: router.getCurrentProvider()?.model,
          usage: json.usage,
          messages: json.messages,
        });
      } catch {
        /* never abort the task for a checkpoint failure */
      }
    },
  });
  failover.prime(router.getCurrentProvider()?.name ?? 'unknown');

  const session = new AgentSession({
    providerRouter: router,
    cwd,
    maxIterations: 50,
    failover,
    verify: { enabled: true, formatter: true, diagnostics: true },
    confirmFn: async (target, _context, safety) => {
      if (opts.yolo) return true;
      return confirmCommand(target, cwd, (safety as any) ?? null);
    },
    delegateFn: async (req) => {
      stopSpinner();
      console.log(
        `  ${chalk.hex(theme.tool)('◆')} ${chalk.hex(theme.tool).bold(`sub-agent ${req.kind}`)} ` +
          chalk.hex(theme.textDim)(req.task.replace(/\s+/g, ' ').slice(0, 60))
      );
      const runner = new SubAgentRunner({
        kind: req.kind,
        task: req.task,
        cwd,
        router,
        contextWindow: Math.min(failover.safeWindow, 128_000),
      });
      return renderSubAgentResult(await runner.run());
    },
    askUserFn: async (questions) => {
      stopSpinner();
      return askQuestions(questions);
    },
    // Agent mode used to discard streamed text entirely: `onText` only stopped
    // the spinner, so the user watched a bare spinner while the model wrote.
    onText(chunk: string) {
      stopSpinner();
      if (!streaming) {
        streaming = true;
        process.stdout.write('\n');
      }
      process.stdout.write(chunk);
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
      if (name === 'todo_write') {
        const panel = renderTodoPanel(todoStore.get(session.id));
        if (panel) {
          console.log();
          console.log(panel);
        }
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

  sessionRef = session;

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
      // The model's text has already been streamed to the terminal; only render
      // it here when nothing was streamed (non-streaming provider).
      if (!streaming) console.log(decodeEntities(renderMarkdown(result)));
      streaming = false;
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
    streaming = false;
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
