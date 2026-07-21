/**
 * Chat Command — Gemini CLI-class Interactive REPL
 */

import { createInterface } from 'readline';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import type { Ora } from 'ora';

import { renderBanner } from '../ui/banner.js';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { COLORS, S, ICONS, TOOL_ICONS } from '../ui/themes/theme.js';
import { handleSlashCommand, getCompletions, type SlashCommandContext } from './slash-commands.js';
import { decodeEntities } from '../utils/html.js';

function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatProviderLabel(provider: any): string {
  if (!provider) return 'Default';
  return `${provider.name}/${provider.model}`;
}

function resolveFileReferences(input: string, cwd: string): { text: string; files: string[] } {
  const files: string[] = [];
  const text = input.replace(/@([\w./\\-]+)/g, (_match, filePath) => {
    const resolved = resolve(cwd, filePath);
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      try {
        const content = readFileSync(resolved, 'utf-8');
        files.push(filePath);
        const truncated = content.slice(0, 50_000);
        return `\n\n<file path="${filePath}">\n${truncated}\n</file>\n\n`;
      } catch {
        return `@${filePath}`;
      }
    }
    return `@${filePath}`;
  });

  return { text, files };
}

export async function chatCommand(options: { model?: string; provider?: string } = {}): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(S.error(`\n  ${ICONS.cross} No providers configured. Run ${S.brand('mycode init')} first.\n`));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  const version = getVersion();
  const cwd = process.cwd();
  const currentProvider = router.getCurrentProvider();

  renderBanner({
    version,
    model: formatProviderLabel(currentProvider),
    providerChain: cfg.providers.map((p: any) => p.name || p.model),
    cwd,
  });

  let currentSpinner: Ora | null = null;
  let streamBuffer = '';
  let isStreaming = false;

  const session = new AgentSession({
    providerRouter: router,
    maxIterations: 25,
    cwd,
    onText(chunk: string) {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      if (!isStreaming) {
        isStreaming = true;
        process.stdout.write('\n');
      }
      process.stdout.write(chalk.hex(COLORS.text)(chunk));
      streamBuffer += chunk;
    },
    onToolCall(toolName: string, _args: Record<string, unknown>) {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      const meta = TOOL_ICONS[toolName] || { icon: ICONS.hexEmpty, verb: toolName, color: COLORS.accent };
      currentSpinner = createToolSpinner(toolName);
      currentSpinner.start();
    },
    onToolResult(name: string, _result: string) {
      if (currentSpinner) {
        const meta = TOOL_ICONS[name] || { icon: ICONS.hexEmpty, verb: name, color: COLORS.accent };
        currentSpinner.succeed(
          `${chalk.hex(meta.color)(meta.icon)} ${chalk.hex(meta.color).bold(meta.verb)} ${S.dim(getToolDetail(name, _result))}`
        );
        currentSpinner = null;
      }
    },
    onError(message: string) {
      if (currentSpinner) {
        currentSpinner.fail(S.error(message));
        currentSpinner = null;
      }
    },
    onFinish(_usage: { promptTokens: number; completionTokens: number }) {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
    },
  });

  let rl: any;

  const completer = (line: string): [string[], string] => {
    const trimmed = line.trim();
    if (trimmed.startsWith('/')) {
      const { completions, displayLines } = getCompletions(trimmed);
      if (completions.length === 0) return [[], line];
      if (completions.length === 1) return [[completions[0]], line];

      console.log();
      for (const dl of displayLines) console.log(dl);
      console.log();
      if (rl) rl.prompt();
      return [[], line];
    }
    return [[], line];
  };

  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${S.brand(ICONS.sparkle)} ${S.brand('❯')} `,
    completer,
    terminal: true,
  });

  const slashCtx: SlashCommandContext = {
    session,
    router,
    cwd,
    version,
    rl,
  };

  let isProcessing = false;
  let lastCtrlC = 0;

  rl.on('SIGINT', () => {
    if (isProcessing) {
      session.abort();
      isProcessing = false;
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
      console.log();
      console.log(`  ${S.warning(ICONS.warning)} Aborted.`);
      rl.prompt();
      return;
    }

    const now = Date.now();
    if (now - lastCtrlC < 500) {
      console.log();
      console.log(`  ${S.dim('Goodbye! 👋')}`);
      rl.close();
      process.exit(0);
    }

    lastCtrlC = now;
    console.log();
    console.log(`  ${S.dim('Press Ctrl+C again to exit.')}`);
    rl.prompt();
  });

  rl.prompt();

  rl.on('line', (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (isProcessing) return;

    if (input.startsWith('/')) {
      isProcessing = true;
      rl.pause();

      handleSlashCommand(input, slashCtx)
        .then((shouldContinue) => {
          if (!shouldContinue) {
            rl.close();
            process.exit(0);
          }
          rl.resume();
          rl.prompt();
        })
        .catch((err: Error) => {
          console.log(`  ${S.error(ICONS.cross)} ${err.message}`);
          rl.resume();
          rl.prompt();
        })
        .finally(() => {
          isProcessing = false;
        });
      return;
    }

    if (input.startsWith('!')) {
      const command = input.slice(1).trim();
      if (!command) {
        rl.prompt();
        return;
      }
      isProcessing = true;
      rl.pause();

      import('child_process').then(({ execSync }) => {
        try {
          console.log();
          console.log(`  ${S.dim('$')} ${chalk.bold(command)}`);
          const output = execSync(command, {
            cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,
          });
          if (output.trim()) {
            console.log(output);
          }
        } catch (err: any) {
          if (err.stdout) console.log(err.stdout);
          if (err.stderr) console.error(S.error(err.stderr));
          console.log(`  ${S.error(`exit ${err.status ?? '?'}`)}`);
        }
      }).finally(() => {
        isProcessing = false;
        rl.resume();
        rl.prompt();
      });
      return;
    }

    isProcessing = true;
    isStreaming = false;
    streamBuffer = '';
    rl.pause();

    const { text: resolvedInput, files } = resolveFileReferences(input, cwd);
    if (files.length > 0) {
      console.log(`  ${S.dim(`Injected ${files.length} file(s): ${files.join(', ')}`)}`);
    }

    const providerLabel = formatProviderLabel(router.getCurrentProvider());
    currentSpinner = createSpinner(providerLabel);
    currentSpinner.start();

    session.run(resolvedInput)
      .then((result: string) => {
        if (currentSpinner) {
          currentSpinner.stop();
          currentSpinner = null;
        }

        if (isStreaming && streamBuffer) {
          console.log();
        } else if (result?.trim()) {
          console.log();
          console.log(decodeEntities(renderMarkdown(result)));
        }

        console.log();
      })
      .catch((err: Error) => {
        if (currentSpinner) {
          currentSpinner.fail(S.error(err.message));
          currentSpinner = null;
        } else {
          console.log(`\n  ${S.error(ICONS.cross)} ${err.message}`);
        }
      })
      .finally(() => {
        isProcessing = false;
        isStreaming = false;
        streamBuffer = '';
        rl.resume();
        rl.prompt();
      });
  });

  await new Promise<void>((resolve) => {
    rl.once('close', resolve);
  });
}

function getToolDetail(name: string, result: string): string {
  if (!result) return '';

  switch (name) {
    case 'readFile':
    case 'read-file': {
      const match = result.match(/lines (\d+)-(\d+) of (\d+)/);
      if (match) {
        const [, start, end, total] = match;
        return start === '1' && end === total ? `${total} lines` : `lines ${start}–${end} of ${total}`;
      }
      return '';
    }
    case 'listDirectory':
    case 'list-dir': {
      const entries = result.split('\n').filter(l => l.includes('│')).length;
      return entries > 0 ? `${entries} entries` : '';
    }
    case 'searchFiles':
    case 'search-files': {
      const matches = result.split('\n').filter(l => l.match(/^\s*\d+\s*│/)).length;
      return matches > 0 ? `${matches} matches` : '';
    }
    default:
      return '';
  }
}
