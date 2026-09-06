/**
 * Slash commands — central COMMAND_REGISTRY (Hermes-agent style).
 *
 * Three kinds of commands are exposed through the `/` menu:
 *   1. Built-in commands (this file), grouped by category
 *   2. Installed skills  → `/<skill-name> [request]`
 *   3. Quick commands    → user-defined in ~/.mycode/settings.json (exec / alias)
 *
 * Commands are case-insensitive; aliases are supported. Several skills can be
 * stacked: `/plan /test-driven-development add caching to the API`.
 */

import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs';
import { platform, homedir } from 'os';
import { join, resolve, relative } from 'path';
import { execSync } from 'child_process';
import { theme, S, ICONS, sectionHeader, frame } from '../ui/themes/theme.js';
import { renderMarkdown as _renderMarkdown } from '../ui/renderer.js';
import { decodeEntities } from '../utils/html.js';

const renderMarkdown = (md: string) => decodeEntities(_renderMarkdown(md));
import {
  skillManager,
  mcpManager,
  sessionStore,
  processManager,
  readMemoryFile,
  writeMemoryFile,
  memoryPath,
  TOOLSETS,
  extractDocument,
  renderDocument,
  isDocumentFile,
  findContextFiles,
  type InstalledSkill,
  type AgentSession,
  type ProviderRouter,
  type MyCodeConfig,
} from '@mycode/core';
import { pickChoiceArrowKeys } from '../ui/prompt.js';
import type { SlashMenuItem } from '../ui/text-area.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SlashCommandContext {
  session: AgentSession;
  router: ProviderRouter;
  config: MyCodeConfig;
  saveConfig: (cfg: MyCodeConfig) => Promise<void>;
  cwd: string;
  version: string;
  /** Run a shell command with approval + streaming output */
  executeCommand: (cmd: string, opts?: { timeoutMs?: number }) => Promise<void>;
  /** Send a prompt to the agent (used by skills, /retry, /plan …) */
  sendPrompt: (prompt: string, opts?: { display?: string }) => Promise<void>;
  /** UI state toggles */
  ui: {
    verbose: 'off' | 'new' | 'all' | 'verbose';
    focus: boolean;
    statusBar: boolean;
    timestamps: boolean;
    yolo: boolean;
    reasoning: 'hide' | 'show';
    personality: string | null;
    loadedSkills: string[];
    plan: boolean;
  };
  /** Rebuild the composer's command list (after skills change etc.) */
  refreshCommands: () => void;
  /** Reset the session (new id, clear history) */
  newSession: (title?: string) => void;
  /** Persist current session to disk */
  autosave: () => void;
}

export interface SlashCommandResult {
  handled: boolean;
  type?: 'exit' | 'clear' | 'new' | 'model_change' | 'skill_load' | 'plan_mode' | 'compact' | 'prompt';
  message?: string;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  argumentHint?: string;
  category: 'Session' | 'Configuration' | 'Tools & Skills' | 'Files & Shell' | 'Info';
  handler: (args: string, ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ok = (msg: string) => console.log(`  ${chalk.hex(theme.green)(ICONS.check)} ${msg}`);
const warn = (msg: string) => console.log(`  ${chalk.hex(theme.amber)(ICONS.warning)} ${msg}`);
const err = (msg: string) => console.log(`  ${chalk.hex(theme.red)(ICONS.cross)} ${msg}`);
const dim = (msg: string) => chalk.hex(theme.dim)(msg);
const usage = (u: string) => console.log(`  ${chalk.hex(theme.amber)('Usage:')} ${u}`);

function formatProvider(p: any): string {
  if (!p) return 'None';
  if (p.name && p.model && (p.name.includes(p.model) || p.name === p.model)) return p.name;
  return `${p.name}/${p.model}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((Math.min(100, pct) / 100) * width);
  const color = pct < 50 ? theme.success : pct < 80 ? theme.warning : pct < 95 ? '#fb923c' : theme.error;
  return chalk.hex(color)('█'.repeat(filled)) + chalk.hex(theme.dim)('░'.repeat(width - filled));
}

function git(cwd: string, cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10_000_000 }).trimEnd();
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').toString().trim();
  }
}

// ─── Command registry ───────────────────────────────────────────────────────

export const COMMANDS: CommandDef[] = [
  // ── Session ────────────────────────────────────────────────────────────────
  {
    name: '/help',
    aliases: ['/h', '/?'],
    description: 'Show all commands, skills and keybindings',
    category: 'Info',
    handler: async (_args, ctx) => {
      console.log();
      const cats: CommandDef['category'][] = ['Session', 'Configuration', 'Tools & Skills', 'Files & Shell', 'Info'];
      for (const cat of cats) {
        const cmds = COMMANDS.filter(c => c.category === cat);
        if (!cmds.length) continue;
        console.log(sectionHeader(cat, { accent: 'green' }));
        for (const cmd of cmds) {
          const aliases = cmd.aliases?.length ? chalk.hex(theme.dim)(` (${cmd.aliases.join(', ')})`) : '';
          const hint = cmd.argumentHint ? chalk.hex(theme.dim)(' ' + cmd.argumentHint) : '';
          console.log(`  ${chalk.hex(theme.green).bold(cmd.name)}${hint}${aliases}`);
          console.log(`    ${chalk.hex(theme.muted)(cmd.description)}`);
        }
        console.log();
      }
      const skills = skillManager.list(ctx.cwd);
      if (skills.length) {
        console.log(sectionHeader('Skills (use as /name [request])', { accent: 'amber' }));
        for (const s of skills.slice(0, 30)) {
          console.log(`  ${chalk.hex(theme.amber)('◆')} ${chalk.hex(theme.green).bold('/' + s.name).padEnd(34)} ${chalk.hex(theme.muted)(s.description.slice(0, 70))}`);
        }
        if (skills.length > 30) console.log(dim(`  … ${skills.length - 30} more — /skills list`));
        console.log();
      }
      const qc = ctx.config.quickCommands ?? {};
      if (Object.keys(qc).length) {
        console.log(sectionHeader('Quick commands', { accent: 'amber' }));
        for (const [n, q] of Object.entries(qc)) console.log(`  ${chalk.hex(theme.greenGlow)('⚡')} ${chalk.hex(theme.green).bold('/' + n).padEnd(20)} ${chalk.hex(theme.muted)(q.description ?? q.command ?? q.target ?? '')}`);
        console.log();
      }
      console.log(sectionHeader('Keys & shortcuts', { accent: 'green' }));
      const keys: Array<[string, string]> = [
        ['Enter', 'send'],
        ['Ctrl+Enter / Shift+Enter / Ctrl+J', 'new line'],
        ['\\ + Enter', 'new line (fallback for any terminal)'],
        ['↑ / ↓', 'move between lines · history at edges'],
        ['Tab', 'accept suggestion · complete /command or @path'],
        ['Ctrl+G', 'edit the prompt in $EDITOR'],
        ['Ctrl+S', 'stash / restore draft'],
        ['Ctrl+C', 'interrupt agent · clear input · twice to exit'],
        ['Ctrl+D', 'exit (on empty prompt)'],
        ['!cmd', 'run a shell command (no model call)'],
        ['@path', 'inject a file (docs/PDF/Office auto-extracted)'],
        ['Enter while agent works', 'queue the message for the next turn'],
      ];
      for (const [k, v] of keys) console.log(`  ${chalk.hex(theme.greenGlow)(k.padEnd(36))} ${chalk.hex(theme.muted)(v)}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/new',
    aliases: ['/reset'],
    description: 'Start a new session (fresh history). Optional name becomes the title',
    argumentHint: '[name]',
    category: 'Session',
    handler: async (args, ctx) => {
      ctx.autosave();
      ctx.newSession(args.trim() || undefined);
      ok(`New session started${args.trim() ? `: ${chalk.bold(args.trim())}` : ''}.`);
      return { handled: true, type: 'new' };
    },
  },
  {
    name: '/clear',
    aliases: ['/c', '/cls'],
    description: 'Clear the screen and start a new session',
    category: 'Session',
    handler: async (_args, ctx) => {
      ctx.autosave();
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      ctx.newSession();
      ok('Screen cleared, new session.');
      return { handled: true, type: 'clear' };
    },
  },
  {
    name: '/retry',
    description: 'Resend the last message',
    category: 'Session',
    handler: async (_args, ctx) => {
      const last = ctx.session.retry();
      if (!last) {
        warn('Nothing to retry.');
        return { handled: true };
      }
      await ctx.sendPrompt(last, { display: `↻ ${last}` });
      return { handled: true, type: 'prompt' };
    },
  },
  {
    name: '/undo',
    description: 'Remove the last user/assistant exchange from history',
    category: 'Session',
    handler: async (_args, ctx) => {
      const removed = ctx.session.undo();
      if (!removed) warn('Nothing to undo.');
      else ok(`Removed last exchange: ${dim(removed.slice(0, 60).replace(/\n/g, ' '))}`);
      return { handled: true };
    },
  },
  {
    name: '/title',
    description: 'Set a title for the current session',
    argumentHint: '<name>',
    category: 'Session',
    handler: async (args, ctx) => {
      if (!args.trim()) {
        console.log(`  Title: ${ctx.session.title ?? dim('(none)')}`);
        return { handled: true };
      }
      ctx.session.title = args.trim();
      ctx.autosave();
      ok(`Session titled "${args.trim()}".`);
      return { handled: true };
    },
  },
  {
    name: '/history',
    description: 'Show the conversation history',
    argumentHint: '[n]',
    category: 'Session',
    handler: async (args, ctx) => {
      const n = parseInt(args, 10) || 20;
      const msgs = ctx.session.getContext().getMessages().filter(m => m.role !== 'system');
      const shown = msgs.slice(-n);
      console.log();
      if (!shown.length) console.log(dim('  (empty)'));
      for (const m of shown) {
        const role = m.role === 'user' ? chalk.hex(theme.green).bold('you') : m.role === 'assistant' ? chalk.hex(theme.amber).bold('mycode') : chalk.hex(theme.dim)(`tool:${m.name}`);
        const body = m.role === 'tool' ? dim(m.content.replace(/\s+/g, ' ').slice(0, 120)) : m.content.trim().slice(0, 500) + (m.content.length > 500 ? dim(' …') : '');
        const calls = m.tool_calls?.length ? dim(` → ${m.tool_calls.map(t => t.function.name).join(', ')}`) : '';
        console.log(`  ${role}${calls}${body ? ': ' + body.replace(/\n/g, '\n    ') : ''}`);
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/save',
    description: 'Save the conversation to ~/.mycode/sessions',
    argumentHint: '[title]',
    category: 'Session',
    handler: async (args, ctx) => {
      if (args.trim()) ctx.session.title = args.trim();
      const data = { ...ctx.session.toJSON(), model: formatProvider(ctx.router.getCurrentProvider()) };
      const file = sessionStore.save(data);
      ok(`Saved session ${chalk.bold(ctx.session.id)} → ${dim(file)}`);
      return { handled: true };
    },
  },
  {
    name: '/resume',
    aliases: ['/load'],
    description: 'Resume a saved session by id, title, or "latest"',
    argumentHint: '<id|title|latest>',
    category: 'Session',
    handler: async (args, ctx) => {
      const q = args.trim();
      if (!q) {
        usage('/resume <id|title|latest>   (see /sessions)');
        return { handled: true };
      }
      const s = sessionStore.load(q);
      if (!s) {
        err(`No session matching "${q}".`);
        return { handled: true };
      }
      ctx.autosave();
      ctx.session.load({ id: s.id, title: s.title, messages: s.messages, usage: s.usage as any });
      const turns = s.messages.filter(m => m.role === 'user').length;
      ok(`Resumed ${chalk.bold(s.title ?? s.id)} — ${turns} turn(s), ${s.messages.length} messages${s.cwd !== ctx.cwd ? chalk.hex(theme.amber)(` (was in ${s.cwd})`) : ''}`);
      // Recap
      const lastUser = [...s.messages].reverse().find(m => m.role === 'user');
      const lastAsst = [...s.messages].reverse().find(m => m.role === 'assistant' && m.content);
      if (lastUser) console.log(`  ${chalk.hex(theme.green)('you')}: ${dim(lastUser.content.replace(/\s+/g, ' ').slice(0, 140))}`);
      if (lastAsst) console.log(`  ${chalk.hex(theme.amber)('mycode')}: ${dim(lastAsst.content.replace(/\s+/g, ' ').slice(0, 140))}`);
      return { handled: true };
    },
  },
  {
    name: '/sessions',
    description: 'Browse and resume saved sessions (interactive picker)',
    argumentHint: '[search]',
    category: 'Session',
    handler: async (args, ctx) => {
      const q = args.trim();
      const list = q ? sessionStore.search(q, 20) : sessionStore.list(20);
      if (!list.length) {
        console.log(dim(q ? `  No sessions matching "${q}".` : '  No saved sessions yet. Use /save or they autosave on exit.'));
        return { handled: true };
      }
      const choices = list.map(s => ({
        name: `${(s.title ?? s.id).slice(0, 34).padEnd(34)} ${dim(s.updatedAt.slice(0, 16).replace('T', ' '))}  ${dim(`${s.messageCount} msgs`)}  ${chalk.hex(theme.muted)((s as any).snippet ?? s.firstPrompt)}`.slice(0, 160),
        value: s.id,
      }));
      choices.push({ name: 'Cancel', value: '' });
      const picked = await pickChoiceArrowKeys('Saved sessions — Enter to resume', choices);
      if (!picked) return { handled: true };
      return COMMANDS.find(c => c.name === '/resume')!.handler(picked, ctx);
    },
  },
  {
    name: '/compress',
    aliases: ['/compact'],
    description: 'Summarise older context to free the window. "here N" keeps last N exchanges',
    argumentHint: '[here [N] | focus topic]',
    category: 'Session',
    handler: async (args, ctx) => {
      const a = args.trim();
      let keepLast = 2;
      let focus: string | undefined;
      const m = a.match(/^here(?:\s+(\d+))?$/i);
      if (m) keepLast = m[1] ? parseInt(m[1], 10) : 2;
      else if (a) focus = a;
      console.log(dim('  Compressing context…'));
      const r = await ctx.session.compress({ keepLast, focus });
      ok(`Context compressed: ${fmtTokens(r.before)} → ${fmtTokens(r.after)} tokens.`);
      return { handled: true, type: 'compact' };
    },
  },
  {
    name: '/queue',
    aliases: ['/q'],
    description: 'Queue a prompt for the next turn',
    argumentHint: '<prompt>',
    category: 'Session',
    handler: async (args, ctx) => {
      if (!args.trim()) return (usage('/queue <prompt>'), { handled: true });
      ctx.session.queuePrompt(args.trim());
      ok(`Queued (${ctx.session.queuedCount} pending).`);
      return { handled: true };
    },
  },
  {
    name: '/steer',
    description: 'Inject a note the agent sees after its next tool call (no interrupt)',
    argumentHint: '<note>',
    category: 'Session',
    handler: async (args, ctx) => {
      if (!args.trim()) return (usage('/steer <note>'), { handled: true });
      ctx.session.steer(args.trim());
      ok('Steering note queued.');
      return { handled: true };
    },
  },
  {
    name: '/stop',
    description: 'Kill all background processes started by the agent',
    category: 'Session',
    handler: async () => {
      const n = await processManager.killAll();
      ok(`Killed ${n} background process(es).`);
      return { handled: true };
    },
  },
  {
    name: '/status',
    description: 'Session info + local recap (model, tokens, files touched, top tools)',
    category: 'Info',
    handler: async (_args, ctx) => {
      const st = ctx.session.getState();
      const active = ctx.router.getCurrentProvider();
      console.log();
      console.log(sectionHeader('Session', { accent: 'green' }));
      const rows: Array<[string, string]> = [
        ['Model', formatProvider(active)],
        ['Session', `${st.id}${st.title ? ` — ${st.title}` : ''}`],
        ['Directory', ctx.cwd],
        ['Duration', fmtDuration(st.elapsedMs)],
        ['Turns', String(st.usage.turns)],
        ['Tool calls', String(st.usage.toolCalls)],
        ['Tokens', `${fmtTokens(st.usage.promptTokens)} in / ${fmtTokens(st.usage.completionTokens)} out`],
        ['Context', `${fmtTokens(st.estimatedTokens)} / ${fmtTokens(st.contextWindow)} ${bar((st.estimatedTokens / st.contextWindow) * 100, 12)}`],
        ['Compressions', String(st.usage.compressions)],
        ['Mode', [ctx.ui.yolo ? chalk.hex(theme.error)('YOLO') : 'approvals on', ctx.ui.plan ? chalk.hex(theme.amber)('plan') : null, ctx.ui.personality ? `personality: ${ctx.ui.personality}` : null].filter(Boolean).join(' · ')],
      ];
      for (const [k, v] of rows) console.log(`  ${chalk.hex(theme.muted)(k.padEnd(14))} ${v}`);
      if (st.filesTouched.length || st.topTools.length) {
        console.log();
        console.log(sectionHeader('Recap', { accent: 'amber' }));
        if (st.topTools.length) console.log(`  ${chalk.hex(theme.muted)('Top tools'.padEnd(14))} ${st.topTools.map(([n, c]) => `${n}×${c}`).join(', ')}`);
        if (st.filesTouched.length) console.log(`  ${chalk.hex(theme.muted)('Files'.padEnd(14))} ${st.filesTouched.slice(-8).join(', ')}`);
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/context',
    aliases: ['/ctx', '/context-window'],
    description: 'Visual context-window breakdown by category',
    argumentHint: '[all]',
    category: 'Info',
    handler: async (args, ctx) => {
      const st = ctx.session.getState();
      const b = ctx.session.getContext().breakdown();
      const win = st.contextWindow;
      const pct = (n: number) => ((n / win) * 100).toFixed(1).padStart(5) + '%';
      console.log();
      console.log(sectionHeader('Context window', { accent: 'green' }));
      console.log(`  ${bar((b.total / win) * 100, 40)} ${fmtTokens(b.total)} / ${fmtTokens(win)} (${((b.total / win) * 100).toFixed(0)}%)`);
      console.log();
      const rows: Array<[string, number]> = [
        ['System prompt + skills index', b.system],
        ['User messages', b.user],
        ['Assistant messages', b.assistant],
        ['Tool results', b.tool],
        ['Free', Math.max(0, win - b.total)],
      ];
      for (const [k, v] of rows) console.log(`  ${chalk.hex(theme.muted)(k.padEnd(30))} ${fmtTokens(v).padStart(7)} ${dim(pct(v))}`);
      if (args.trim() === 'all') {
        console.log();
        console.log(sectionHeader('Tools', { accent: 'amber' }));
        const defs = ctx.session.getRegistry().getDefinitions();
        for (const d of defs) console.log(`  ${chalk.hex(theme.muted)(d.function.name.padEnd(30))} ${dim(`~${Math.ceil(JSON.stringify(d).length / 4)} tokens`)}`);
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/usage',
    aliases: ['/stats', '/token-limit'],
    description: 'Token usage for this session',
    category: 'Info',
    handler: async (_args, ctx) => {
      const u = ctx.session.getUsage();
      console.log();
      console.log(sectionHeader('Usage', { accent: 'green' }));
      console.log(`  Input tokens:   ${fmtTokens(u.promptTokens)}`);
      console.log(`  Output tokens:  ${fmtTokens(u.completionTokens)}`);
      console.log(`  Total:          ${fmtTokens(u.totalTokens)}`);
      console.log(`  Turns:          ${u.turns}   Tool calls: ${u.toolCalls}   Compressions: ${u.compressions}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/diff',
    description: 'Show git changes (unstaged + untracked by default)',
    argumentHint: '[staged|all] [--stat] [path…]',
    category: 'Files & Shell',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const mode = parts.find(p => ['staged', 'all'].includes(p)) ?? '';
      const stat = parts.includes('--stat') ? ' --stat' : '';
      const paths = parts.filter(p => !['staged', 'all', '--stat'].includes(p)).map(p => `'${p}'`).join(' ');
      const cmd = mode === 'staged' ? `diff --staged${stat} -- ${paths}` : mode === 'all' ? `diff HEAD${stat} -- ${paths}` : `diff${stat} -- ${paths}`;
      let out = git(ctx.cwd, cmd);
      if (!mode && !stat) {
        const untracked = git(ctx.cwd, 'ls-files --others --exclude-standard');
        if (untracked) out += `\n\nUntracked files:\n${untracked.split('\n').map(f => '  ' + f).join('\n')}`;
      }
      console.log();
      if (!out.trim()) console.log(dim('  No changes.'));
      else console.log(renderMarkdown('```diff\n' + out.slice(0, 40_000) + '\n```'));
      console.log();
      return { handled: true };
    },
  },

  // ── Configuration ──────────────────────────────────────────────────────────
  {
    name: '/model',
    aliases: ['/m'],
    description: 'Show or switch the active model/provider (interactive picker with no args)',
    argumentHint: '[name]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const target = args.trim();
      const stats = ctx.router.getStats();
      const active = ctx.router.getCurrentProvider();
      if (!target) {
        const choices = stats.map(s => ({ name: `${formatProvider(s)}${active && s.model === active.model ? chalk.hex(theme.green)('  (active)') : ''}`, value: s.name }));
        choices.push({ name: 'Cancel', value: '' });
        const picked = await pickChoiceArrowKeys('Select model', choices);
        if (!picked) return { handled: true };
        ctx.router.setActiveProvider(picked);
        ok(`Switched to ${chalk.bold(formatProvider(ctx.router.getCurrentProvider()))}`);
        await ctx.session.refreshSystemPrompt();
        return { handled: true, type: 'model_change' };
      }
      if (ctx.router.setActiveProvider(target)) {
        ok(`Switched to ${chalk.bold(formatProvider(ctx.router.getCurrentProvider()))}`);
        await ctx.session.refreshSystemPrompt();
      } else {
        warn(`No configured model matching "${target}". Available: ${stats.map(formatProvider).join(', ')}`);
        console.log(dim('  Add providers with: mycode config add'));
      }
      return { handled: true, type: 'model_change' };
    },
  },
  {
    name: '/config',
    description: 'Show configuration (providers, preferences, paths)',
    category: 'Configuration',
    handler: async (_args, ctx) => {
      const cfg = ctx.config;
      console.log();
      console.log(sectionHeader('Configuration', { accent: 'green' }));
      console.log(`  Config:       ${dim(join(homedir(), '.mycode', 'settings.json'))}`);
      console.log(`  Skills:       ${dim(skillManager.getSkillsDir())}`);
      console.log(`  Sessions:     ${dim(sessionStore.getDir())}`);
      console.log(`  Memory:       ${dim(memoryPath())}`);
      console.log(`  Confirm cmds: ${cfg.preferences.confirmCommands}   Confirm writes: ${cfg.preferences.confirmWrites}`);
      console.log(`  Providers:`);
      for (const p of cfg.providers) console.log(`    ${chalk.hex(theme.green)('•')} ${p.name.padEnd(16)} ${dim(p.apiProvider.padEnd(11))} ${p.model}${p.baseUrl ? dim(`  ${p.baseUrl}`) : ''}`);
      if (cfg.disabledTools?.length) console.log(`  Disabled tools: ${cfg.disabledTools.join(', ')}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/personality',
    description: 'Apply a personality overlay to the system prompt (none to clear)',
    argumentHint: '[name|none]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const builtin: Record<string, string> = {
        concise: 'Personality: extremely concise. Short sentences, no filler, no restating the question. Code and commands over prose.',
        teacher: 'Personality: patient teacher. Explain the why behind each change briefly, point out relevant concepts, suggest what to learn next.',
        reviewer: 'Personality: rigorous code reviewer. Skeptical by default; call out risks, edge cases and missing tests before praising anything.',
        pair: 'Personality: friendly pair programmer. Think out loud briefly, propose options, ask before large refactors.',
      };
      const all = { ...builtin, ...(ctx.config.personalities ?? {}) };
      const name = args.trim().toLowerCase();
      if (!name) {
        console.log(`  Active: ${ctx.ui.personality ?? dim('none')}`);
        console.log(`  Available: ${Object.keys(all).join(', ')}, none`);
        return { handled: true };
      }
      if (['none', 'default', 'neutral'].includes(name)) {
        ctx.ui.personality = null;
        ctx.session.addSystemSection('Personality overlay cleared — return to default behaviour.');
        ok('Personality cleared.');
        return { handled: true };
      }
      if (!all[name]) {
        warn(`Unknown personality "${name}". Available: ${Object.keys(all).join(', ')}`);
        return { handled: true };
      }
      ctx.ui.personality = name;
      ctx.session.addSystemSection(all[name]);
      ok(`Personality set to ${chalk.bold(name)}.`);
      return { handled: true };
    },
  },
  {
    name: '/verbose',
    description: 'Cycle tool output display: off → new → all → verbose',
    argumentHint: '[off|new|all|verbose]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const order: SlashCommandContext['ui']['verbose'][] = ['off', 'new', 'all', 'verbose'];
      const a = args.trim() as any;
      ctx.ui.verbose = order.includes(a) ? a : order[(order.indexOf(ctx.ui.verbose) + 1) % order.length];
      ok(`Tool display: ${chalk.bold(ctx.ui.verbose)}`);
      return { handled: true };
    },
  },
  {
    name: '/focus',
    description: 'Focus view — hide tool chatter, show only your prompt and the final answer',
    argumentHint: '[on|off]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const a = args.trim();
      ctx.ui.focus = a === 'on' ? true : a === 'off' ? false : !ctx.ui.focus;
      ok(`Focus view ${ctx.ui.focus ? 'on' : 'off'}.`);
      return { handled: true };
    },
  },
  {
    name: '/reasoning',
    description: 'Show or hide model reasoning (when the provider streams it)',
    argumentHint: '[show|hide]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const a = args.trim();
      ctx.ui.reasoning = a === 'show' || a === 'on' ? 'show' : a === 'hide' || a === 'off' ? 'hide' : ctx.ui.reasoning === 'show' ? 'hide' : 'show';
      ok(`Reasoning display: ${ctx.ui.reasoning}`);
      return { handled: true };
    },
  },
  {
    name: '/statusbar',
    aliases: ['/sb'],
    description: 'Toggle the status bar above the prompt',
    category: 'Configuration',
    handler: async (_args, ctx) => {
      ctx.ui.statusBar = !ctx.ui.statusBar;
      ok(`Status bar ${ctx.ui.statusBar ? 'on' : 'off'}.`);
      return { handled: true };
    },
  },
  {
    name: '/timestamps',
    description: 'Toggle [HH:MM] timestamps on messages',
    category: 'Configuration',
    handler: async (_args, ctx) => {
      ctx.ui.timestamps = !ctx.ui.timestamps;
      ok(`Timestamps ${ctx.ui.timestamps ? 'on' : 'off'}.`);
      return { handled: true };
    },
  },
  {
    name: '/yolo',
    description: 'Toggle YOLO mode — skip all command/write approval prompts',
    category: 'Configuration',
    handler: async (_args, ctx) => {
      ctx.ui.yolo = !ctx.ui.yolo;
      if (ctx.ui.yolo) console.log(`  ${chalk.hex(theme.error).bold('⚠ YOLO mode ON')} — commands and edits run without confirmation.`);
      else ok('YOLO mode off — approvals restored.');
      return { handled: true };
    },
  },
  {
    name: '/approvals',
    description: 'Set approval mode: manual (ask everything), smart (ask for risky only), off',
    argumentHint: '[manual|smart|off]',
    category: 'Configuration',
    handler: async (args, ctx) => {
      const a = args.trim();
      if (!a) {
        const mode = ctx.ui.yolo ? 'off' : ctx.config.preferences.confirmCommands && ctx.config.preferences.confirmWrites ? 'manual' : 'smart';
        console.log(`  Approval mode: ${chalk.bold(mode)}`);
        return { handled: true };
      }
      if (a === 'off') ctx.ui.yolo = true;
      else if (a === 'manual') {
        ctx.ui.yolo = false;
        ctx.config.preferences.confirmCommands = true;
        ctx.config.preferences.confirmWrites = true;
      } else if (a === 'smart') {
        ctx.ui.yolo = false;
        ctx.config.preferences.confirmCommands = true;
        ctx.config.preferences.confirmWrites = false;
      } else return (usage('/approvals [manual|smart|off]'), { handled: true });
      await ctx.saveConfig(ctx.config);
      ok(`Approval mode: ${a}`);
      return { handled: true };
    },
  },

  // ── Tools & Skills ─────────────────────────────────────────────────────────
  {
    name: '/tools',
    aliases: ['/t'],
    description: 'List tools, or enable/disable them for this session',
    argumentHint: '[list|enable|disable] [name…]',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const [action = 'list', ...names] = args.trim().split(/\s+/).filter(Boolean);
      const reg = ctx.session.getRegistry();
      if (action === 'enable' || action === 'disable') {
        if (!names.length) return (usage(`/tools ${action} <name…>`), { handled: true });
        for (const n of names) {
          const done = action === 'enable' ? reg.enable(n) : reg.disable(n);
          if (done) ok(`${action}d ${reg.canonical(n)}`);
          else warn(`Unknown tool: ${n}`);
        }
        await ctx.session.refreshSystemPrompt();
        return { handled: true };
      }
      console.log();
      console.log(sectionHeader('Tools', { accent: 'green' }));
      for (const ts of reg.getToolsets()) {
        console.log(`  ${chalk.hex(theme.amber).bold(ts.name)} ${dim(`(${ts.enabled}/${ts.tools.length})`)}`);
        for (const t of ts.tools) {
          const def = reg.getTool(t)?.definition.function;
          if (!def) continue;
          const on = reg.isEnabled(t);
          console.log(`    ${on ? chalk.hex(theme.green)('●') : chalk.hex(theme.dim)('○')} ${chalk.bold(t).padEnd(24)} ${dim(def.description.slice(0, 80))}`);
        }
      }
      console.log(dim('\n  /tools disable <name>  ·  /tools enable <name>'));
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/toolsets',
    description: 'List toolsets',
    category: 'Tools & Skills',
    handler: async () => {
      console.log();
      for (const [n, tools] of Object.entries(TOOLSETS)) console.log(`  ${chalk.hex(theme.green).bold(n.padEnd(10))} ${dim(tools.join(', '))}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/skills',
    aliases: ['/sk', '/skill'],
    description: 'List, view, search, install, create, or remove skills',
    argumentHint: '[list|view|search|install|create|remove|reload|reset] [args]',
    category: 'Tools & Skills',
    handler: async (argsStr, ctx) => {
      const parts = argsStr.trim().split(/\s+/).filter(Boolean);
      const action = parts[0] || 'list';
      const rest = parts.slice(1);

      switch (action) {
        case 'list':
        case 'ls': {
          const skills = skillManager.list(ctx.cwd);
          console.log();
          console.log(sectionHeader(`Skills (${skills.length})`, { accent: 'green' }));
          if (!skills.length) console.log(dim('  None installed. Try: /skills search <topic>  or  /skills create <name>'));
          const byCat = new Map<string, InstalledSkill[]>();
          for (const s of skills) {
            const k = s.category ?? 'general';
            byCat.set(k, [...(byCat.get(k) ?? []), s]);
          }
          for (const [cat, list] of [...byCat.entries()].sort()) {
            console.log(`  ${chalk.hex(theme.amber).bold(cat)}`);
            for (const s of list) {
              const origin = s.origin === 'workspace' ? chalk.hex(theme.greenGlow)(' ws') : s.origin === 'external' ? dim(' ext') : '';
              console.log(`    ${chalk.hex(theme.green).bold(('/' + s.name).padEnd(30))} ${chalk.hex(theme.muted)(s.description.slice(0, 70))}${origin}`);
            }
          }
          console.log(dim(`\n  Location: ${skillManager.getSkillsDir()}  ·  /skills view <name>  ·  /<name> <request>`));
          console.log();
          return { handled: true };
        }
        case 'view':
        case 'show':
        case 'info': {
          if (!rest[0]) return (usage('/skills view <name> [file]'), { handled: true });
          try {
            const content = skillManager.view(rest[0], rest[1], ctx.cwd);
            console.log();
            console.log(renderMarkdown(content));
            console.log();
          } catch (e: any) {
            err(e.message);
          }
          return { handled: true };
        }
        case 'search':
        case 'browse': {
          const q = rest.join(' ');
          console.log(dim(`  Searching skill hubs${q ? ` for "${q}"` : ''}…`));
          try {
            const res = await skillManager.search(q, 25);
            if (!res.length) console.log(dim('  No results.'));
            for (const r of res) console.log(`  ${chalk.hex(theme.amber)('◆')} ${chalk.bold(r.name.padEnd(28))} ${dim(r.source + '/' + (r.path ?? ''))}`);
            if (res.length) console.log(dim('\n  Install: /skills install <owner/repo/path>  e.g. /skills install ' + res[0].source + '/' + res[0].path));
          } catch (e: any) {
            err(`Search failed: ${e.message}`);
          }
          return { handled: true };
        }
        case 'install':
        case 'add': {
          if (!rest[0]) return (usage('/skills install <owner/repo/path | github url>   or   /skills install <name> <owner/repo>'), { handled: true });
          try {
            console.log(dim('  Downloading…'));
            const r = rest.length >= 2 && !rest[0].includes('/') ? await skillManager.addSkill(rest[0], rest[1], rest[2]) : await skillManager.addSkill(rest[0]);
            ok(`Installed ${chalk.bold(r.name)} (${r.files.length} file(s)) → ${dim(r.path)}`);
            ctx.refreshCommands();
            await ctx.session.refreshSystemPrompt();
          } catch (e: any) {
            err(e.message);
          }
          return { handled: true };
        }
        case 'create':
        case 'new': {
          if (!rest[0]) return (usage('/skills create <name> [description]'), { handled: true });
          const name = rest[0];
          const desc = rest.slice(1).join(' ') || `${name} skill`;
          try {
            const p = skillManager.createSkill(
              name,
              `---\nname: ${name}\ndescription: ${desc}\nversion: 1.0.0\n---\n\n# ${name}\n\n## When to Use\n\n## Procedure\n1. \n\n## Pitfalls\n\n## Verification\n`
            );
            ok(`Created ${dim(p)} — edit it, or ask: "improve the ${name} skill"`);
            ctx.refreshCommands();
          } catch (e: any) {
            err(e.message);
          }
          return { handled: true };
        }
        case 'remove':
        case 'rm':
        case 'delete': {
          if (!rest[0]) return (usage('/skills remove <name>'), { handled: true });
          const done = skillManager.removeSkill(rest[0], ctx.cwd);
          if (done) {
            ok(`Removed ${rest[0]}.`);
            ctx.refreshCommands();
          } else warn(`Skill "${rest[0]}" not found.`);
          return { handled: true };
        }
        case 'reload': {
          skillManager.invalidate();
          ctx.refreshCommands();
          await ctx.session.refreshSystemPrompt();
          ok(`Reloaded ${skillManager.list(ctx.cwd).length} skills.`);
          return { handled: true };
        }
        case 'reset': {
          if (!rest[0]) return (usage(`/skills reset <name>   (bundled: ${skillManager.getBundledNames().join(', ')})`), { handled: true });
          if (skillManager.resetBundledSkill(rest[0])) ok(`Restored bundled skill ${rest[0]}.`);
          else warn(`${rest[0]} is not a bundled skill.`);
          return { handled: true };
        }
        default:
          usage('/skills [list|view <name>|search <q>|install <src>|create <name>|remove <name>|reload|reset <name>]');
          return { handled: true };
      }
    },
  },
  {
    name: '/reload-skills',
    aliases: ['/reload_skills'],
    description: 'Re-scan skill directories',
    category: 'Tools & Skills',
    handler: async (_a, ctx) => COMMANDS.find(c => c.name === '/skills')!.handler('reload', ctx),
  },
  {
    name: '/learn',
    description: 'Distil a reusable skill from a directory, URL, document, or the current conversation',
    argumentHint: '<what to learn from>',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const what = args.trim();
      if (!what) return (usage('/learn <directory | url | file | description of the workflow>'), { handled: true });
      const prompt = `Create a reusable skill from the following source: ${what}

Steps:
1. Gather the material with your tools (read_file/search_files for directories, web_fetch for URLs, read_document for PDFs/Office files, or the conversation so far if it refers to what we just did).
2. Distil it into procedural knowledge — decision rules, commands, pitfalls — never paste large source passages.
3. Author SKILL.md following the house format: YAML frontmatter (name in kebab-case, description ≤60 chars, version, category, tags), then sections "When to Use", "Procedure" (numbered), "Pitfalls", "Verification". Reference tools by their real names.
4. If the source is large (a book, many docs), keep SKILL.md lean and put per-topic notes in references/<topic>.md via skill_manage(action="write_file").
5. Save with skill_manage(action="create"). If a skill on this topic already exists, merge into it with patch/edit instead of duplicating.
6. Report the skill name and path.`;
      await ctx.sendPrompt(prompt, { display: `/learn ${what}` });
      return { handled: true, type: 'prompt' };
    },
  },
  {
    name: '/plan',
    description: 'Write an implementation plan to .mycode/plans/ without executing anything',
    argumentHint: '[task]',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const task = args.trim();
      const plansDir = join(ctx.cwd, '.mycode', 'plans');
      const prompt = `PLAN MODE — planning only, do not implement.
${task ? `Task: ${task}` : 'Task: infer the task from our conversation so far.'}

1. Inspect the relevant code with read-only tools (glob, search_files, read_file, git_status). Do not run write_file/patch/terminal except the single write in step 3.
2. Produce a markdown plan with: Goal · Context (files/modules, current behaviour) · Steps (numbered; each names files to touch and the change) · Risks & open questions · Verification (tests/commands).
3. Save it to ${plansDir}/${new Date().toISOString().slice(0, 10)}-<short-slug>.md with write_file, then print the plan.`;
      await ctx.sendPrompt(prompt, { display: `/plan ${task}`.trim() });
      return { handled: true, type: 'plan_mode' };
    },
  },
  {
    name: '/init',
    description: 'Generate or update MYCODE.md project instructions from a repo scan',
    argumentHint: '[notes]',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const existing = findContextFiles(ctx.cwd).filter(f => f.path.startsWith(ctx.cwd));
      const prompt = `Inspect this repository (manifests, directory layout, build/test/lint config, CI, conventions) using read-only tools, then ${existing.length ? `update ${existing[0].path} — preserve the user's existing content and merge in what's missing` : 'write a concise MYCODE.md at the repository root'}.
Include: what the project is; how to install, build, test and lint (exact commands); code style & conventions actually used; architecture overview (key directories); gotchas. Keep it under ~120 lines, no fluff.${args.trim() ? `\nEmphasise: ${args.trim()}` : ''}`;
      await ctx.sendPrompt(prompt, { display: `/init ${args.trim()}`.trim() });
      return { handled: true, type: 'prompt' };
    },
  },
  {
    name: '/review',
    description: 'Review the current diff (or a path/PR) for bugs, security and style',
    argumentHint: '[path|instructions]',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const skill = skillManager.find('code-review', ctx.cwd);
      const body = skill ? skillManager.buildInvocation(skill, args.trim() || 'Review the current git diff.') : `Review ${args.trim() || 'the current git diff (git diff; git diff --staged)'} for correctness, security, error handling, performance and readability. Group findings by severity with file:line and concrete fixes.`;
      await ctx.sendPrompt(body, { display: `/review ${args.trim()}`.trim() });
      return { handled: true, type: 'prompt' };
    },
  },
  {
    name: '/btw',
    description: 'Ask a side question about the conversation without adding it to history',
    argumentHint: '<question>',
    category: 'Tools & Skills',
    handler: async (args, ctx) => {
      const q = args.trim();
      if (!q) return (usage('/btw <question>'), { handled: true });
      const msgs = ctx.session.getContext().getMessages();
      const transcript = msgs
        .filter(m => m.role !== 'system')
        .slice(-30)
        .map(m => `[${m.role}${m.name ? ':' + m.name : ''}] ${m.content.slice(0, 1500)}`)
        .join('\n');
      console.log(dim('  Thinking (side question, not saved to history)…'));
      try {
        const res = await ctx.router.chat(
          [
            { role: 'system', content: 'Answer the user\'s side question about the following conversation transcript. Be brief and direct.' },
            { role: 'user', content: `Transcript:\n${transcript}\n\nQuestion: ${q}` },
          ],
          undefined,
          { max_tokens: 800 }
        );
        console.log();
        console.log(renderMarkdown(res?.content ?? '(no answer)'));
        console.log();
      } catch (e: any) {
        err(e.message);
      }
      return { handled: true };
    },
  },
  {
    name: '/memory',
    description: 'Show or edit persistent memory (~/.mycode/MEMORY.md)',
    argumentHint: '[add <text>|remove <text>|clear]',
    category: 'Tools & Skills',
    handler: async (args) => {
      const [action = '', ...rest] = args.trim().split(/\s+/);
      const text = rest.join(' ');
      if (!action) {
        const mem = readMemoryFile().trim();
        console.log();
        console.log(frame(mem || dim('(empty) — the agent stores durable facts here via the memory tool'), { title: 'Memory', borderColor: theme.green }));
        console.log();
        return { handled: true };
      }
      if (action === 'add' && text) {
        const mem = readMemoryFile();
        writeMemoryFile((mem.trim() ? mem.trimEnd() + '\n' : '# Memory\n') + `- ${text}\n`);
        ok('Added to memory.');
      } else if (action === 'remove' && text) {
        const lines = readMemoryFile().split('\n');
        const kept = lines.filter(l => !l.includes(text));
        writeMemoryFile(kept.join('\n'));
        ok(`Removed ${lines.length - kept.length} line(s).`);
      } else if (action === 'clear') {
        writeMemoryFile('');
        ok('Memory cleared.');
      } else usage('/memory [add <text>|remove <text>|clear]');
      return { handled: true };
    },
  },
  {
    name: '/mcp',
    description: 'Show MCP servers',
    category: 'Tools & Skills',
    handler: async () => {
      const servers = mcpManager.listServers();
      console.log();
      console.log(sectionHeader('MCP servers', { accent: 'green' }));
      if (!servers.length) console.log(dim('  None configured (settings.json → mcp.servers).'));
      for (const s of servers) console.log(`  ${chalk.hex(theme.green)('●')} ${s.name} ${dim(`(${s.status})`)}`);
      console.log();
      return { handled: true };
    },
  },

  // ── Files & Shell ──────────────────────────────────────────────────────────
  {
    name: '/run',
    aliases: ['/sh', '/!'],
    description: 'Run a shell command (same as !cmd)',
    argumentHint: '<command>',
    category: 'Files & Shell',
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!command) return (usage('/run <command>'), { handled: true });
      await ctx.executeCommand(command, { timeoutMs: 600_000 });
      return { handled: true };
    },
  },
  {
    name: '/read',
    aliases: ['/cat', '/open'],
    description: 'Print a file (PDF/Office docs are extracted) — optionally add it to context',
    argumentHint: '<path> [--add]',
    category: 'Files & Shell',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const add = parts.includes('--add');
      const p = parts.filter(x => x !== '--add').join(' ');
      if (!p) return (usage('/read <path> [--add]'), { handled: true });
      const abs = resolve(ctx.cwd, p);
      if (!existsSync(abs)) return (err(`Not found: ${p}`), { handled: true });
      if (statSync(abs).isDirectory()) {
        const entries = readdirSync(abs, { withFileTypes: true }).map(e => (e.isDirectory() ? e.name + '/' : e.name));
        console.log('\n  ' + entries.join('\n  ') + '\n');
        return { handled: true };
      }
      let text: string;
      if (isDocumentFile(abs)) {
        const doc = await extractDocument(abs);
        text = renderDocument(doc, { maxChars: 60_000 });
      } else {
        text = readFileSync(abs, 'utf-8');
      }
      console.log();
      const ext = abs.split('.').pop() ?? '';
      console.log(isDocumentFile(abs) ? renderMarkdown(text) : renderMarkdown('```' + ext + '\n' + text.slice(0, 60_000) + '\n```'));
      console.log();
      if (add) {
        ctx.session.getContext().addMessage({ role: 'user', content: `<file path="${relative(ctx.cwd, abs)}">\n${text.slice(0, 80_000)}\n</file>` });
        ctx.session.getContext().addMessage({ role: 'assistant', content: `Noted — I've read ${relative(ctx.cwd, abs)}.` });
        ok('Added to context.');
      }
      return { handled: true };
    },
  },
  {
    name: '/ls',
    aliases: ['/tree'],
    description: 'List files (respects .gitignore when in a git repo)',
    argumentHint: '[path] [depth]',
    category: 'Files & Shell',
    handler: async (args, ctx) => {
      const [p = '.', d = '2'] = args.trim().split(/\s+/);
      const depth = Math.min(6, parseInt(d, 10) || 2);
      const root = resolve(ctx.cwd, p);
      const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'target']);
      const lines: string[] = [];
      const walk = (dir: string, prefix: string, level: number) => {
        if (level > depth || lines.length > 400) return;
        let entries: import('fs').Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true }).filter(e => !ignored.has(e.name) && !e.name.startsWith('.'));
        } catch {
          return;
        }
        entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        entries.forEach((e, i) => {
          const last = i === entries.length - 1;
          lines.push(`${prefix}${last ? '└─ ' : '├─ '}${e.isDirectory() ? chalk.hex(theme.greenGlow)(e.name + '/') : e.name}`);
          if (e.isDirectory()) walk(join(dir, e.name), prefix + (last ? '   ' : '│  '), level + 1);
        });
      };
      console.log(`\n  ${chalk.bold(relative(ctx.cwd, root) || '.')}`);
      walk(root, '  ', 1);
      console.log(lines.join('\n') + '\n');
      return { handled: true };
    },
  },
  {
    name: '/cd',
    description: 'Show the working directory (changing it requires a restart: mycode --in <dir>)',
    category: 'Files & Shell',
    handler: async (_a, ctx) => {
      console.log(`  ${ctx.cwd}`);
      return { handled: true };
    },
  },
  {
    name: '/git',
    description: 'Quick git status + recent log',
    category: 'Files & Shell',
    handler: async (_a, ctx) => {
      console.log();
      console.log(sectionHeader('Git', { accent: 'green' }));
      console.log(`  Branch: ${chalk.bold(git(ctx.cwd, 'branch --show-current') || '(detached)')}`);
      const status = git(ctx.cwd, 'status --short');
      console.log(status ? status.split('\n').map(l => '  ' + l).join('\n') : dim('  clean'));
      console.log();
      console.log(git(ctx.cwd, 'log --oneline -8').split('\n').map(l => '  ' + dim(l)).join('\n'));
      console.log();
      return { handled: true };
    },
  },

  // ── Info ───────────────────────────────────────────────────────────────────
  {
    name: '/about',
    aliases: ['/version'],
    description: 'Version, OS, Node and environment info',
    category: 'Info',
    handler: async (_args, ctx) => {
      console.log();
      console.log(sectionHeader('About MyCode', { accent: 'green' }));
      console.log(`  Version:      v${ctx.version}`);
      console.log(`  Model:        ${formatProvider(ctx.router.getCurrentProvider())}`);
      console.log(`  OS:           ${platform()} · Node ${process.version}`);
      console.log(`  CWD:          ${ctx.cwd}`);
      console.log(`  Skills:       ${skillManager.list(ctx.cwd).length} installed`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/prompt',
    aliases: ['/compose', '/editor'],
    description: 'Compose the next prompt in $EDITOR (same as Ctrl+G)',
    category: 'Session',
    handler: async () => {
      // Handled specially by the chat loop (needs the TextArea); fall back to hint.
      console.log(dim('  Press Ctrl+G in the prompt to open your editor.'));
      return { handled: true };
    },
  },
  {
    name: '/exit',
    aliases: ['/quit', '/q!', '/bye'],
    description: 'Exit MyCode',
    category: 'Session',
    handler: async () => {
      return { handled: true, type: 'exit' };
    },
  },
];

// ─── Menu construction ──────────────────────────────────────────────────────

/** Build the menu list shown by the composer: built-ins + skills + quick commands. */
export function buildMenuItems(cwd: string, config?: MyCodeConfig): SlashMenuItem[] {
  const items: SlashMenuItem[] = COMMANDS.map(c => ({
    name: c.name,
    description: c.description,
    aliases: c.aliases,
    argumentHint: c.argumentHint,
    kind: 'command' as const,
  }));
  const taken = new Set(items.flatMap(i => [i.name, ...(i.aliases ?? [])]));
  for (const [name, q] of Object.entries(config?.quickCommands ?? {})) {
    const n = `/${name}`;
    if (taken.has(n)) continue;
    taken.add(n);
    items.push({ name: n, description: q.description ?? (q.type === 'alias' ? `→ ${q.target}` : `$ ${q.command}`), kind: 'quick' });
  }
  try {
    for (const s of skillManager.list(cwd)) {
      const n = `/${s.name}`;
      if (taken.has(n)) continue;
      taken.add(n);
      items.push({ name: n, description: s.description || '(skill)', argumentHint: s.frontmatter.argumentHint ?? '[request]', kind: 'skill' });
    }
  } catch {
    /* ignore */
  }
  return items;
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export function findCommand(name: string): CommandDef | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find(c => c.name === n || c.aliases?.includes(n));
}

export async function handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  if (trimmed === '/') return findCommand('/help')!.handler('', ctx);

  const spaceIdx = trimmed.search(/\s/);
  const cmdName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  // 1. Built-in
  const command = findCommand(cmdName);
  if (command) return command.handler(args, ctx);

  // 2. Quick command (user-defined)
  const qc = ctx.config.quickCommands?.[cmdName.slice(1)];
  if (qc) {
    if (qc.type === 'alias' && qc.target) return handleSlashCommand(`${qc.target} ${args}`.trim(), ctx);
    if (qc.command) {
      await ctx.executeCommand(args ? `${qc.command} ${args}` : qc.command);
      return { handled: true };
    }
  }

  // 3. Skills — allow stacking several leading /skill tokens
  const tokens = trimmed.split(/\s+/);
  const loaded: InstalledSkill[] = [];
  let i = 0;
  while (i < tokens.length && i < 5 && tokens[i].startsWith('/')) {
    const s = skillManager.find(tokens[i].slice(1), ctx.cwd);
    if (!s) break;
    loaded.push(s);
    i++;
  }
  if (loaded.length) {
    const request = tokens.slice(i).join(' ');
    const blocks = loaded.map((s, idx) => skillManager.buildInvocation(s, idx === loaded.length - 1 ? request : ''));
    // When stacking, only the last block carries the user's request; strip the "invoked without request" tail from the others.
    const body = blocks
      .map((b, idx) => (idx < blocks.length - 1 ? b.replace(/\n\nThe user invoked this skill without[\s\S]*$/, '') : b))
      .join('\n\n');
    ctx.ui.loadedSkills.push(...loaded.map(s => s.name));
    console.log(`  ${chalk.hex(theme.amber)('◆')} Loaded skill${loaded.length > 1 ? 's' : ''}: ${loaded.map(s => chalk.bold(s.name)).join(', ')}`);
    await ctx.sendPrompt(body, { display: trimmed });
    return { handled: true, type: 'skill_load' };
  }

  // 4. Unknown → suggestions
  const all = buildMenuItems(ctx.cwd, ctx.config);
  const q = cmdName.slice(1);
  const near = all.filter(c => c.name.slice(1).startsWith(q.slice(0, 3)) || c.name.includes(q)).slice(0, 5);
  warn(`Unknown command ${chalk.bold(cmdName)}.${near.length ? ` Did you mean: ${near.map(n => n.name).join(', ')}?` : ''} Type ${chalk.hex(theme.green).bold('/help')} for the list.`);
  return { handled: true };
}

export function getCompletions(partial: string, cwd = process.cwd()): { completions: string[]; displayLines: string[] } {
  const lower = partial.toLowerCase();
  const matches = buildMenuItems(cwd).filter(c => c.name.startsWith(lower) || c.aliases?.some(a => a.startsWith(lower)));
  return {
    completions: matches.map(c => c.name + ' '),
    displayLines: matches.map(c => `  ${chalk.hex(theme.green).bold(c.name.padEnd(16))} ${chalk.hex(theme.muted)(c.description)}`),
  };
}

// Silence unused-import lints for helpers that are handy in future commands.
void S;
void mkdirSync;
void writeFileSync;
