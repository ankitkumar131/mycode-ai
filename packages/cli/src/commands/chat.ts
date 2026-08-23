/**
 * Chat Command — Interactive REPL with a true multiline text area (openclaude / agy style).
 *
 * Input behavior:
 *   - Enter           → send the query
 *   - Shift+Enter     → insert a new line
 *   - ↑/↓             → move the cursor inside your text; history at the edges
 *   - ←/→, Home/End, Ctrl+A/E/W/K/U, Ctrl+←/→, Ctrl+L … → full editing shortcuts
 *   - /               → live-filtering slash command menu (openclaude style)
 *   - !cmd            → run a shell command directly
 *   - @file           → inject file contents into the query
 *   - Ctrl+C          → clear input, then exit on second press
 *   - Every auto-run shell command asks: Yes (execute once) / Always allow / No (skip)
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import type { Ora } from 'ora';

import { renderBanner } from '../ui/banner.js';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { COLORS, S, ICONS, TOOL_ICONS } from '../ui/themes/theme.js';
import { TextArea } from '../ui/text-area.js';
import { handleSlashCommand, COMMANDS, type SlashCommandContext } from './slash-commands.js';
import { pickSlashCommandInteractive } from '../ui/slash-picker.js';
import { decodeEntities } from '../utils/html.js';
import { getLocalPackageInfo } from '../utils/update-check.js';
import { confirmCommand } from '../ui/prompt.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getVersion(): string {
  return getLocalPackageInfo().version;
}

function formatProviderLabel(provider: any): string {
  if (!provider) return 'Default';
  const name = provider.name || '';
  const model = provider.model || '';
  if (!model || name === model) return name || 'Default';
  if (model.startsWith(name + '/') || model.startsWith(name + ':')) return model;
  return `${name}/${model}`;
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
    case 'readPDF':
    case 'readDocument':
    case 'read-document': {
      const match = result.match(/Length: (\d+) characters/) || result.match(/Pages: (\d+)/);
      if (match) return `${match[1]} chars`;
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

// ─── Chat Command ───────────────────────────────────────────────────────────

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
  const normalPrompt = `${S.brand(ICONS.sparkle)} ${S.brand('❯')} `;

  renderBanner({
    version,
    model: formatProviderLabel(currentProvider),
    providerChain: cfg.providers.map((p: any) => p.name || p.model),
    cwd,
  });

  // ─── Agent session ──────────────────────────────────────────────────────

  let currentSpinner: Ora | null = null;
  let streamBuffer = '';
  let isStreaming = false;

  const session = new AgentSession({
    providerRouter: router,
    maxIterations: 25,
    cwd,
    confirmFn: async (target, context, safety) => {
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      // User config may disable confirmation prompts
      if (safety && !cfg.preferences.confirmCommands) return true;
      if (!safety && !cfg.preferences.confirmWrites) return true;
      return confirmCommand(target, cwd, (safety as any) ?? null, context ?? null);
    },
    onText(chunk: string) {
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      if (!isStreaming) { isStreaming = true; process.stdout.write('\n'); }
      process.stdout.write(chalk.hex(COLORS.text)(chunk));
      streamBuffer += chunk;
    },
    onToolCall(toolName: string, _args: Record<string, unknown>) {
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      currentSpinner = createToolSpinner(toolName);
      currentSpinner.start();
    },
    onToolResult(name: string, result: string) {
      if (currentSpinner) {
        const meta = TOOL_ICONS[name] || { icon: ICONS.hexEmpty, verb: name, color: COLORS.accent };
        currentSpinner.succeed(
          `${chalk.hex(meta.color)(meta.icon)} ${chalk.hex(meta.color).bold(meta.verb)} ${S.dim(getToolDetail(name, result))}`
        );
        currentSpinner = null;
      }
    },
    onError(message: string) {
      if (currentSpinner) { currentSpinner.fail(S.error(message)); currentSpinner = null; }
    },
    onFinish() {
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
    },
  });

  // ─── Text area ──────────────────────────────────────────────────────────

  const textArea = new TextArea({
    prompt: normalPrompt,
    placeholder: 'Ask anything —  / for commands  ·  ! shell  ·  @file',
    commands: COMMANDS,
    onInterrupt: () => {
      session.abort();
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      process.stdout.write('\n');
      console.log(`  ${S.warning(ICONS.warning)} Aborted.`);
    },
  });

  const slashCtx: SlashCommandContext = {
    session,
    router,
    cwd,
    version,
    rl: textArea as any,
    executeCommand: async (cmd: string, opts: any) => {
      const { executeCommand } = await import('@mycode/core');
      const { classifyCommand } = await import('../../../core/src/tools/command-safety.js');
      const safety = classifyCommand(cmd);
      if (safety.level === 'blocked') throw new Error(`Command blocked: ${safety.reason}`);
      if (cfg.preferences.confirmCommands) {
        const ok = await confirmCommand(cmd, cwd, safety, null);
        if (!ok) throw new Error('Command cancelled by user');
      }
      const result = await executeCommand(cmd, cwd, { timeout: opts?.timeoutMs ?? 120_000 });
      if (result.output?.trim()) console.log(result.output);
      if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode ?? '?'}`);
    },
  };

  // ─── Core action helpers ────────────────────────────────────────────────

  const processInputText = async (inputText: string): Promise<void> => {
    textArea.setBusy(true);
    isStreaming = false;
    streamBuffer = '';

    const { text: resolvedInput, files } = resolveFileReferences(inputText, cwd);
    if (files.length > 0) {
      console.log(`  ${S.dim(`Injected ${files.length} file(s): ${files.join(', ')}`)}`);
    }

    const providerLabel = formatProviderLabel(router.getCurrentProvider());
    currentSpinner = createSpinner(providerLabel);
    currentSpinner.start();

    try {
      const result = await session.run(resolvedInput);
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      if (isStreaming && streamBuffer) {
        console.log();
      } else if (result?.trim()) {
        console.log();
        console.log(decodeEntities(renderMarkdown(result)));
      }
      console.log();
    } catch (err: any) {
      if (currentSpinner) {
        currentSpinner.fail(S.error(err.message));
        currentSpinner = null;
      } else {
        console.log(`\n  ${S.error(ICONS.cross)} ${err.message}`);
      }
    } finally {
      isStreaming = false;
      streamBuffer = '';
      textArea.setBusy(false);
    }
  };

  // ─── Main loop ──────────────────────────────────────────────────────────

  try {
    while (true) {
      const submit = await textArea.read();
      if (!submit || submit.kind === 'exit') break;

      // Slash command selected from the inline menu
      if (submit.kind === 'slash') {
        textArea.setBusy(true);
        const res = await handleSlashCommand(submit.name, slashCtx)
          .catch((err: Error) => {
            console.log(`  ${S.error(ICONS.cross)} ${err.message}`);
            return undefined;
          });
        textArea.setBusy(false);
        if (res?.type === 'exit') break;
        console.log();
        continue;
      }

      const input = submit.text.trim();
      if (!input) continue;

      // Slash commands typed manually
      if (input.startsWith('/')) {
        textArea.setBusy(true);
        const runSlash = async (): Promise<any> => {
          let cmdToRun = input;
          const hasSpace = input.includes(' ');
          const isExact = COMMANDS.some(c =>
            c.name.toLowerCase() === input.toLowerCase() ||
            c.aliases?.includes(input.toLowerCase())
          );
          if (!hasSpace && !isExact) {
            const picked = await pickSlashCommandInteractive(input);
            if (!picked) return undefined;
            cmdToRun = picked;
          }
          return handleSlashCommand(cmdToRun, slashCtx);
        };

        const res = await runSlash()
          .catch((err: Error) => {
            console.log(`  ${S.error(ICONS.cross)} ${err.message}`);
            return undefined;
          });
        textArea.setBusy(false);
        if (res?.type === 'exit') break;
        console.log();
        continue;
      }

      // Shell commands
      if (input.startsWith('!')) {
        const command = input.slice(1).trim();
        if (!command) continue;
        textArea.setBusy(true);
        await import('child_process').then(({ execSync }) => {
          try {
            console.log();
            console.log(`  ${S.dim('$')} ${chalk.bold(command)}`);
            const output = execSync(command, {
              cwd,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 120_000,
            });
            if (output.trim()) console.log(output);
          } catch (err: any) {
            if (err.stdout) console.log(err.stdout);
            if (err.stderr) console.error(S.error(err.stderr));
            console.log(`  ${S.error(`exit ${err.status ?? '?'}`)}`);
          }
        });
        textArea.setBusy(false);
        console.log();
        continue;
      }

      // Regular text → send to AI
      await processInputText(input);
    }
  } finally {
    textArea.close();
  }
}
