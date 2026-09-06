/**
 * Chat Command — Interactive REPL (Hermes-agent style TUI).
 *
 *   Enter                         → send
 *   Ctrl+Enter / Shift+Enter /
 *   Alt+Enter / Ctrl+J / \+Enter  → new line
 *   ↑/↓                           → move inside text; history at the edges
 *   Tab                           → accept ghost suggestion, complete /command or @path
 *   Ctrl+G                        → edit prompt in $EDITOR      Ctrl+S → stash draft
 *   Ctrl+C                        → interrupt / clear / exit(×2) Ctrl+D → exit
 *   /command                      → live-filtering command menu (built-ins + skills + quick commands)
 *   !cmd                          → shell command (no model call, `! exited <code>`)
 *   @path                         → inject a file (PDF/Office extracted automatically)
 *   Enter while the agent works   → queue the message for the next turn
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';
import { homedir } from 'os';
import {
  ConfigManager,
  AgentSession,
  ProviderRouter,
  executeCommand,
  classifyCommand,
  skillManager,
  sessionStore,
  processManager,
  isDocumentFile,
  extractDocument,
  renderDocument,
  type MyCodeConfig,
} from '@mycode/core';
import chalk from 'chalk';
import type { Ora } from 'ora';

import { renderBanner } from '../ui/banner.js';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { COLORS, S, ICONS, TOOL_ICONS, theme, stripAnsi } from '../ui/themes/theme.js';
import { TextArea } from '../ui/text-area.js';
import { handleSlashCommand, buildMenuItems, type SlashCommandContext } from './slash-commands.js';
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

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, '0')}m`;
}

function contextWindowFor(cfg: MyCodeConfig, provider: any): number {
  const model: string = provider?.model ?? '';
  const table = cfg.contextWindows ?? {};
  for (const [k, v] of Object.entries(table)) if (model.includes(k)) return v;
  const m = model.toLowerCase();
  if (/gemini/.test(m)) return 1_000_000;
  if (/claude|gpt-4\.1|gpt-5|o3|o4|deepseek|qwen3|kimi|grok/.test(m)) return 200_000;
  if (/gpt-4o|llama-?3|mistral|gemma/.test(m)) return 128_000;
  return 128_000;
}

/** Resolve @path references, extracting PDFs/Office docs as text. */
async function resolveFileReferences(input: string, cwd: string): Promise<{ text: string; files: string[] }> {
  const files: string[] = [];
  const re = /(^|\s)@([\w./\\~-]+)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const [full, lead, rawPath] = m;
    const filePath = rawPath.startsWith('~') ? join(homedir(), rawPath.slice(1)) : rawPath;
    const resolved = resolve(cwd, filePath);
    out += input.slice(last, m.index) + lead;
    last = m.index + full.length;
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      try {
        let content: string;
        if (isDocumentFile(resolved)) {
          const doc = await extractDocument(resolved);
          content = renderDocument(doc, { maxChars: 60_000 });
        } else {
          content = readFileSync(resolved, 'utf-8').slice(0, 50_000);
        }
        files.push(rawPath);
        out += `\n\n<file path="${relative(cwd, resolved) || rawPath}">\n${content}\n</file>\n\n`;
        continue;
      } catch {
        /* fall through */
      }
    }
    out += `@${rawPath}`;
  }
  out += input.slice(last);
  return { text: out, files };
}

function getToolDetail(name: string, args: Record<string, unknown> | undefined, result: string): string {
  const arg = (k: string) => (args?.[k] !== undefined ? String(args[k]) : '');
  const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  switch (name) {
    case 'read_file': {
      const match = result.match(/lines (\d+)-(\d+) of (\d+)/);
      const p = arg('path');
      if (match) {
        const [, start, end, total] = match;
        return `${p} ${start === '1' && end === total ? `(${total} lines)` : `(${start}–${end}/${total})`}`;
      }
      return p;
    }
    case 'read_document':
    case 'read_pdf': {
      const match = result.match(/(\d+) (?:pages|slides|sheets|paragraphs)/i) || result.match(/Length: (\d+) characters/);
      return `${arg('path')}${match ? ` (${match[0]})` : ''}`;
    }
    case 'write_file':
    case 'patch':
      return arg('path');
    case 'list_dir':
    case 'glob':
      return arg('path') || arg('pattern');
    case 'search_files': {
      const matches = result.split('\n').filter(l => /^\s*\d+\s*[│:]/.test(l)).length;
      return `${short(arg('pattern') || arg('query'), 40)}${matches ? ` — ${matches} matches` : ''}`;
    }
    case 'terminal':
    case 'execute_code':
      return short(arg('command') || arg('code'), 70);
    case 'process':
      return `${arg('action')} ${arg('id') || arg('command')}`.trim();
    case 'web_fetch':
      return short(arg('url'), 70);
    case 'web_search':
      return short(arg('query'), 60);
    case 'skill_view':
    case 'skill_manage':
      return `${arg('action')} ${arg('name')}`.trim();
    case 'memory':
      return arg('action');
    default:
      return '';
  }
}

// ─── Chat Command ───────────────────────────────────────────────────────────

export interface ChatOptions {
  model?: string;
  provider?: string;
  /** Resume the most recent session for this directory */
  continue?: boolean;
  /** Resume a specific session by id/title */
  resume?: string;
  /** Run one query and exit */
  query?: string;
  /** Skip all approval prompts */
  yolo?: boolean;
}

export async function chatCommand(options: ChatOptions = {}): Promise<void> {
  const configManager = new ConfigManager();
  const cfg = configManager.configExists() ? await configManager.load() : configManager.get();

  if (cfg.providers.length === 0) {
    console.log(S.error(`\n  ${ICONS.cross} No providers configured. Run ${S.brand('mycode init')} first.\n`));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  if (options.model || options.provider) router.setActiveProvider(options.model ?? options.provider!);
  const version = getVersion();
  const cwd = process.cwd();
  const normalPrompt = `${S.brand(ICONS.sparkle)} ${S.brand('❯')} `;
  const oneShot = !!options.query;

  // Skills: make sure bundled skills exist, index external dirs from config
  try {
    skillManager.configure({ externalDirs: cfg.skills?.externalDirs ?? [] });
    if (!cfg.skills?.noBundled) skillManager.seedBundledSkills();
  } catch {
    /* non-fatal */
  }

  if (!oneShot) {
    renderBanner({
      version,
      model: formatProviderLabel(router.getCurrentProvider()),
      providerChain: cfg.providers.map((p: any) => p.name || p.model),
      cwd,
    });
  }

  // ─── UI state ───────────────────────────────────────────────────────────

  const ui: SlashCommandContext['ui'] = {
    verbose: 'new',
    focus: false,
    statusBar: true,
    timestamps: false,
    yolo: !!options.yolo,
    reasoning: 'hide',
    personality: null,
    loadedSkills: [],
    plan: false,
  };

  let currentSpinner: Ora | null = null;
  let streamBuffer = '';
  let isStreaming = false;
  let reasoningShown = false;
  let turnStart = 0;
  let textArea: TextArea | null = null;

  const stopSpinner = () => {
    if (currentSpinner) {
      currentSpinner.stop();
      currentSpinner = null;
    }
  };
  const out = (line: string) => (textArea && textArea.isBusy() === false ? textArea.log(line) : console.log(line));
  const stamp = () => (ui.timestamps ? chalk.hex(theme.dim)(`[${new Date().toTimeString().slice(0, 5)}] `) : '');

  // ─── Agent session ──────────────────────────────────────────────────────

  const session = new AgentSession({
    providerRouter: router,
    maxIterations: 40,
    cwd,
    contextWindow: contextWindowFor(cfg, router.getCurrentProvider()),
    toolRegistry: undefined,
    confirmFn: async (target, context, safety) => {
      stopSpinner();
      if (ui.yolo) return true;
      if (safety && !cfg.preferences.confirmCommands) return true;
      if (!safety && !cfg.preferences.confirmWrites) return true;
      return confirmCommand(target, cwd, (safety as any) ?? null, context ?? null);
    },
    onText(chunk: string) {
      stopSpinner();
      if (reasoningShown) {
        process.stdout.write('\n');
        reasoningShown = false;
      }
      if (!isStreaming) {
        isStreaming = true;
        process.stdout.write('\n');
      }
      process.stdout.write(chalk.hex(COLORS.text)(chunk));
      streamBuffer += chunk;
    },
    onReasoning(chunk: string) {
      if (ui.reasoning !== 'show') return;
      stopSpinner();
      if (!reasoningShown) {
        process.stdout.write('\n' + chalk.hex(theme.dim).italic('  ◇ thinking: '));
        reasoningShown = true;
      }
      process.stdout.write(chalk.hex(theme.dim).italic(chunk.replace(/\n/g, '\n  ')));
    },
    onToolCall(toolName: string, args: Record<string, unknown>) {
      stopSpinner();
      if (isStreaming) {
        process.stdout.write('\n');
        isStreaming = false;
      }
      if (ui.focus || ui.verbose === 'off') return;
      const meta = TOOL_ICONS[toolName] || { icon: ICONS.hexEmpty, verb: toolName, color: COLORS.accent };
      currentSpinner = createToolSpinner(`${meta.verb} ${chalk.hex(theme.dim)(getToolDetail(toolName, args, ''))}`);
      currentSpinner.start();
      (currentSpinner as any).__args = args;
    },
    onToolResult(name: string, result: string, meta) {
      const args = (currentSpinner as any)?.__args as Record<string, unknown> | undefined;
      const icon = TOOL_ICONS[name] || { icon: ICONS.hexEmpty, verb: name, color: COLORS.accent };
      const detail = getToolDetail(name, args, result);
      const dur = meta.durationMs > 1500 ? chalk.hex(theme.dim)(` ${(meta.durationMs / 1000).toFixed(1)}s`) : '';
      if (currentSpinner) {
        const line = `${chalk.hex(icon.color)(icon.icon)} ${chalk.hex(meta.error ? theme.error : icon.color).bold(icon.verb)} ${S.dim(detail)}${dur}`;
        if (meta.error) currentSpinner.fail(line);
        else currentSpinner.succeed(line);
        currentSpinner = null;
      }
      if ((ui.verbose === 'all' || ui.verbose === 'verbose') && !ui.focus && result) {
        const max = ui.verbose === 'verbose' ? 4000 : 600;
        const body = result.length > max ? result.slice(0, max) + `\n… (${result.length - max} more chars)` : result;
        console.log(chalk.hex(theme.dim)(body.split('\n').map(l => '      ' + l).join('\n')));
      }
    },
    onError(message: string) {
      if (currentSpinner) {
        currentSpinner.fail(S.error(message));
        currentSpinner = null;
      } else console.log(`  ${S.error(ICONS.cross)} ${message}`);
    },
    onCompress({ before, after }) {
      stopSpinner();
      console.log(`  ${chalk.hex(theme.amber)('⟲')} ${chalk.hex(theme.dim)(`context compressed ${fmtTokens(before)} → ${fmtTokens(after)} tokens`)}`);
    },
    onFinish() {
      stopSpinner();
    },
  });
  if (cfg.disabledTools?.length) for (const t of cfg.disabledTools) session.getRegistry().disable(t);

  // Resume?
  if (options.continue || options.resume) {
    const saved = options.resume ? sessionStore.load(options.resume) : sessionStore.latestFor(cwd);
    if (saved) {
      session.load({ id: saved.id, title: saved.title, messages: saved.messages, usage: saved.usage as any });
      console.log(`  ${chalk.hex(theme.green)(ICONS.check)} Resumed session ${chalk.bold(saved.title ?? saved.id)} ${chalk.hex(theme.dim)(`(${saved.messages.filter(m => m.role === 'user').length} turns)`)}\n`);
    } else console.log(`  ${chalk.hex(theme.amber)(ICONS.warning)} No saved session to resume — starting fresh.\n`);
  }

  const autosave = () => {
    try {
      if (session.getContext().getMessages().some(m => m.role === 'user')) {
        sessionStore.save({ ...session.toJSON(), model: formatProviderLabel(router.getCurrentProvider()) });
      }
    } catch {
      /* ignore */
    }
  };

  // ─── Status line (Hermes-style) ──────────────────────────────────────────

  const statusLine = (): string | null => {
    if (!ui.statusBar) return null;
    const st = session.getState();
    const w = process.stdout.columns ?? 80;
    const pct = Math.min(100, (st.estimatedTokens / st.contextWindow) * 100);
    const color = pct < 50 ? theme.success : pct < 80 ? theme.warning : pct < 95 ? '#fb923c' : theme.error;
    const barW = 10;
    const filled = Math.round((pct / 100) * barW);
    const bar = chalk.hex(color)('█'.repeat(filled)) + chalk.hex(theme.dim)('░'.repeat(barW - filled));
    const sep = chalk.hex(theme.dim)(' │ ');
    const parts = [
      chalk.hex(theme.green)('⚕ ') + chalk.hex(theme.greenGlow)(formatProviderLabel(router.getCurrentProvider())),
      chalk.hex(color)(`${fmtTokens(st.estimatedTokens)}/${fmtTokens(st.contextWindow)}`),
      `${bar} ${chalk.hex(color)(pct.toFixed(0) + '%')}`,
      chalk.hex(theme.dim)(fmtDuration(st.elapsedMs)),
    ];
    if (ui.yolo) parts.push(chalk.hex(theme.error).bold('YOLO'));
    if (st.queued) parts.push(chalk.hex(theme.amber)(`${st.queued} queued`));
    if (textArea?.stashCount) parts.push(chalk.hex(theme.amber)(`${textArea.stashCount} stashed`));
    if (ui.personality) parts.push(chalk.hex(theme.dim)(ui.personality));
    let line = ' ' + parts.join(sep);
    if (stripAnsi(line).length > w - 1) line = ' ' + parts.slice(0, 3).join(sep);
    return line;
  };

  // ─── Text area ──────────────────────────────────────────────────────────

  const refreshCommands = () => textArea?.setCommands(buildMenuItems(cwd, cfg));

  textArea = new TextArea({
    prompt: normalPrompt,
    placeholder: 'Ask anything —  / commands  ·  ! shell  ·  @file  ·  Ctrl+Enter newline',
    commands: buildMenuItems(cwd, cfg),
    cwd,
    statusLine,
    historyFile: join(homedir(), '.mycode', 'history.json'),
    onInterrupt: () => {
      session.abort();
      stopSpinner();
      process.stdout.write('\n');
      console.log(`  ${S.warning(ICONS.warning)} Interrupted.`);
    },
    onBusySubmit: (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (t.startsWith('/steer ')) {
        session.steer(t.slice(7));
        console.log(`  ${chalk.hex(theme.amber)('↪')} ${chalk.hex(theme.dim)('steering note queued')}`);
        return;
      }
      session.queuePrompt(t);
      console.log(`  ${chalk.hex(theme.amber)('⏳')} ${chalk.hex(theme.dim)(`queued for next turn (${session.queuedCount} pending) — Ctrl+C to interrupt now`)}`);
    },
  });

  // ─── Shell runner (approval + streaming output) ─────────────────────────

  const runShell = async (command: string, opts?: { timeoutMs?: number }): Promise<number> => {
    const safety = classifyCommand(command);
    if (safety.level === 'blocked') {
      console.log(`  ${S.error(ICONS.cross)} Command blocked: ${safety.reason}`);
      return 126;
    }
    if (!ui.yolo && cfg.preferences.confirmCommands) {
      const ok = await confirmCommand(command, cwd, safety, null);
      if (!ok) {
        console.log(`  ${chalk.hex(theme.dim)('cancelled')}`);
        return 130;
      }
    }
    console.log();
    console.log(`  ${chalk.hex(theme.green).bold('$')} ${chalk.bold(command)}`);
    const result = await executeCommand(command, cwd, {
      timeout: opts?.timeoutMs ?? 600_000,
      onLog: (line: string) => process.stdout.write(line.endsWith('\n') ? line : line + '\n'),
    });
    if (!result.output?.trim() && result.stderr?.trim()) console.log(S.error(result.stderr));
    const code = result.exitCode ?? (result.timedOut ? 124 : 0);
    console.log(code === 0 ? chalk.hex(theme.dim)(`  ! exited 0`) : S.error(`  ! exited ${code}`));
    return code;
  };

  // ─── Agent turn ─────────────────────────────────────────────────────────

  const sendPrompt = async (prompt: string, opts: { display?: string } = {}): Promise<void> => {
    textArea!.setBusy(true);
    isStreaming = false;
    reasoningShown = false;
    streamBuffer = '';
    turnStart = Date.now();

    const { text: resolvedInput, files } = await resolveFileReferences(prompt, cwd);
    if (files.length > 0) console.log(`  ${S.dim(`Injected ${files.length} file(s): ${files.join(', ')}`)}`);
    if (opts.display && ui.timestamps) console.log(`  ${stamp()}${chalk.hex(theme.dim)(opts.display.slice(0, 80))}`);

    const providerLabel = formatProviderLabel(router.getCurrentProvider());
    currentSpinner = createSpinner(providerLabel);
    currentSpinner.start();

    try {
      const result = await session.run(resolvedInput);
      stopSpinner();
      if (isStreaming && streamBuffer) {
        // Streamed text is already on screen; just terminate the line.
        console.log();
      } else if (result?.trim()) {
        console.log();
        console.log(decodeEntities(renderMarkdown(result)));
      }
      const u = session.getUsage();
      const st = session.getState();
      console.log(
        chalk.hex(theme.dim)(
          `  ${stamp()}${fmtDuration(Date.now() - turnStart)} · ${fmtTokens(u.promptTokens)} in / ${fmtTokens(u.completionTokens)} out · ctx ${((st.estimatedTokens / st.contextWindow) * 100).toFixed(0)}%${st.aborted ? ' · interrupted' : ''}`
        )
      );
      console.log();
    } catch (err: any) {
      if (currentSpinner) {
        currentSpinner.fail(S.error(err.message));
        currentSpinner = null;
      } else console.log(`\n  ${S.error(ICONS.cross)} ${err.message}`);
    } finally {
      isStreaming = false;
      reasoningShown = false;
      streamBuffer = '';
      textArea!.setBusy(false);
      autosave();
    }

    // Drain queued prompts
    const next = session.dequeuePrompt();
    if (next) {
      console.log(`  ${chalk.hex(theme.amber)('▶')} ${chalk.hex(theme.dim)('queued:')} ${next.slice(0, 100)}`);
      await dispatch(next);
    }
  };

  const slashCtx: SlashCommandContext = {
    session,
    router,
    config: cfg,
    saveConfig: c => configManager.save(c),
    cwd,
    version,
    executeCommand: async (cmd, opts) => {
      await runShell(cmd, opts);
    },
    sendPrompt,
    ui,
    refreshCommands,
    newSession: (title?: string) => {
      session.reset();
      session.title = title ?? null;
      ui.loadedSkills = [];
    },
    autosave,
  };

  const dispatch = async (input: string): Promise<'exit' | void> => {
    if (!input) return;

    if (input.startsWith('/')) {
      textArea!.setBusy(true);
      try {
        const res = await handleSlashCommand(input, slashCtx);
        if (res?.type === 'exit') return 'exit';
        if (res?.type === 'model_change') session.getContext().maxTokens = contextWindowFor(cfg, router.getCurrentProvider());
      } catch (err: any) {
        console.log(`  ${S.error(ICONS.cross)} ${err.message}`);
      } finally {
        textArea!.setBusy(false);
      }
      console.log();
      return;
    }

    if (input.startsWith('!')) {
      const command = input.slice(1).trim();
      if (!command) return;
      textArea!.setBusy(true);
      try {
        await runShell(command);
      } finally {
        textArea!.setBusy(false);
      }
      console.log();
      return;
    }

    await sendPrompt(input);
  };

  // ─── One-shot mode (`mycode chat -q "…"`) ───────────────────────────────

  if (oneShot) {
    try {
      await dispatch(options.query!.trim());
    } finally {
      textArea.close();
      await processManager.killAll();
    }
    return;
  }

  // ─── Main loop ──────────────────────────────────────────────────────────

  try {
    while (true) {
      const submit = await textArea.read();
      if (!submit || submit.kind === 'exit') break;
      const input = submit.kind === 'slash' ? submit.name : submit.text.trim();
      if (!input) continue;
      const r = await dispatch(input);
      if (r === 'exit') break;
    }
  } finally {
    textArea.close();
    autosave();
    await processManager.killAll();
    const u = session.getUsage();
    if (u.turns > 0) {
      console.log(
        chalk.hex(theme.dim)(
          `\n  Session ${session.id} saved · ${u.turns} turn(s) · ${fmtTokens(u.totalTokens)} tokens · resume with: mycode --continue\n`
        )
      );
    }
  }
}
