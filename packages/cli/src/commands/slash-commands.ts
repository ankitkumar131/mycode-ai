/**
 * Slash Commands — Gemini CLI-style interactive REPL commands
 * Extracted module for clean separation from the chat loop.
 */

import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { platform } from 'os';
import { COLORS, S, ICONS, hr } from '../ui/themes/theme.js';

export interface SlashCommandContext {
  session: any;        // AgentSession
  router: any;         // ProviderRouter
  cwd: string;
  version: string;
  rl: any;             // readline.Interface
  executeCommand?: (cmd: string, opts: any) => Promise<any>;
}

interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: (args: string, ctx: SlashCommandContext) => Promise<boolean>;
}

function formatProvider(p: any): string {
  if (!p) return 'None';
  return `${p.name}/${p.model}`;
}

const COMMANDS: CommandDef[] = [
  {
    name: '/help',
    aliases: ['/h', '/?'],
    description: 'Show all available commands',
    handler: async () => {
      console.log();
      console.log(S.accentBold('  Commands'));
      console.log(`  ${S.dim('─'.repeat(40))}`);

      for (const cmd of COMMANDS) {
        const aliases = cmd.aliases?.length ? S.dim(` (${cmd.aliases.join(', ')})`) : '';
        console.log(
          `  ${S.brand(cmd.name.padEnd(16))}${aliases}`
        );
        console.log(`  ${S.dim('  ' + cmd.description)}`);
      }

      console.log();
      console.log(S.dim('  Shortcuts:'));
      console.log(S.dim('  !command    — Run shell command directly'));
      console.log(S.dim('  @file.txt   — Inject file content into message'));
      console.log();
      return true;
    },
  },
  {
    name: '/model',
    aliases: ['/m'],
    description: 'View or switch the active provider/model',
    usage: '/model [name]',
    handler: async (args, ctx) => {
      const target = args.trim();
      const stats = ctx.router.getStats();

      if (!target) {
        console.log();
        console.log(S.accentBold('  Available Models'));
        console.log(`  ${S.dim('─'.repeat(35))}`);

        const active = ctx.router.getCurrentProvider();
        for (const stat of stats) {
          const label = `${stat.name}/${stat.model}`;
          const isActive = active && stat.model === active.model;
          if (isActive) {
            console.log(`  ${S.success(ICONS.dot)} ${chalk.bold(label)} ${S.success('(active)')}`);
          } else {
            console.log(`  ${S.dim(ICONS.circle)} ${label}`);
          }
        }
        console.log();
        console.log(S.dim('  Switch: /model <name>'));
        console.log();
      } else {
        const success = ctx.router.setActiveProvider(target);
        if (success) {
          console.log(`  ${S.success(ICONS.check)} Switched to: ${S.accentBold(formatProvider(ctx.router.getCurrentProvider()))}`);
        } else {
          console.log(`  ${S.warning(ICONS.warning)} No model matching "${target}". Use /model to see options.`);
        }
      }
      return true;
    },
  },
  {
    name: '/stats',
    aliases: ['/s'],
    description: 'Show session token usage and stats',
    handler: async (_args, ctx) => {
      const state = ctx.session.getState();
      const active = ctx.router.getCurrentProvider();

      console.log();
      console.log(S.accentBold('  Session Stats'));
      console.log(`  ${S.dim('─'.repeat(30))}`);
      console.log(`  Messages:     ${state.messageCount ?? 'N/A'}`);
      console.log(`  Iterations:   ${state.iterations}`);
      console.log(`  Active model: ${S.accent(formatProvider(active))}`);
      console.log();
      return true;
    },
  },
  {
    name: '/clear',
    aliases: ['/c'],
    description: 'Clear conversation history',
    handler: async (_args, ctx) => {
      const context = ctx.session.getContext();
      if (context?.clear) {
        context.clear();
      }
      console.log(`  ${S.success(ICONS.check)} Conversation cleared.`);
      return true;
    },
  },
  {
    name: '/tools',
    aliases: ['/t'],
    description: 'List available tools',
    handler: async (_args, ctx) => {
      const registry = ctx.session.getRegistry();
      const defs = registry.getDefinitions({ filterWriteTools: false });

      console.log();
      console.log(S.accentBold('  Available Tools'));
      console.log(`  ${S.dim('─'.repeat(35))}`);

      for (const def of defs) {
        const name = def.function.name;
        const desc = def.function.description?.split('.')[0] || '';
        console.log(`  ${S.cyan(name.padEnd(20))} ${S.dim(desc)}`);
      }
      console.log();
      return true;
    },
  },
  {
    name: '/save',
    description: 'Save conversation to a file',
    usage: '/save [filename]',
    handler: async (args, ctx) => {
      const filename = args.trim() || 'conversation.json';
      try {
        const context = ctx.session.getContext();
        const messages = context?.getHistory ? context.getHistory() : [];
        writeFileSync(filename, JSON.stringify(messages, null, 2), 'utf-8');
        console.log(`  ${S.success(ICONS.check)} Saved ${messages.length} messages to ${S.brand(filename)}`);
      } catch (err: any) {
        console.log(`  ${S.error(ICONS.cross)} Failed to save: ${err.message}`);
      }
      return true;
    },
  },
  {
    name: '/load',
    description: 'Load conversation from a file',
    usage: '/load [filename]',
    handler: async (args, ctx) => {
      const filename = args.trim() || 'conversation.json';
      try {
        if (!existsSync(filename)) {
          console.log(`  ${S.error(ICONS.cross)} File not found: ${filename}`);
          return true;
        }
        const data = JSON.parse(readFileSync(filename, 'utf-8'));
        console.log(`  ${S.success(ICONS.check)} Loaded ${data.length} messages from ${S.brand(filename)}`);
        console.log(`  ${S.dim('Note: This replaces the current conversation context.')}`);
      } catch (err: any) {
        console.log(`  ${S.error(ICONS.cross)} Failed to load: ${err.message}`);
      }
      return true;
    },
  },
  {
    name: '/compact',
    description: 'Compress conversation context to save tokens',
    handler: async (_args, ctx) => {
      const context = ctx.session.getContext();
      if (context?.trimToLimit) {
        context.trimToLimit();
        console.log(`  ${S.success(ICONS.check)} Context compacted. Messages: ${context.length}`);
      } else {
        console.log(`  ${S.dim('Context compaction not available.')}`);
      }
      return true;
    },
  },
  {
    name: '/run',
    aliases: ['/!'],
    description: 'Execute a shell command directly (bypass AI)',
    usage: '/run <command>',
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!command) {
        console.log(`  ${S.warning(ICONS.warning)} Usage: /run <command>`);
        console.log(`  ${S.dim('Example: /run git status')}`);
        return true;
      }

      if (ctx.executeCommand) {
        console.log();
        console.log(`  ${S.dim('Running:')} ${chalk.bold(command)}`);
        try {
          await ctx.executeCommand(command, { cwd: ctx.cwd, timeoutMs: 120_000, stream: true });
        } catch (err: any) {
          console.log(`  ${S.error(ICONS.cross)} ${err.message}`);
        }
      } else {
        console.log(`  ${S.dim('Command execution not available in this session.')}`);
      }
      return true;
    },
  },
  {
    name: '/about',
    description: 'Show version, shell, OS, and model info',
    handler: async (_args, ctx) => {
      const isWindows = platform() === 'win32';
      const shell = isWindows ? 'PowerShell' : process.env.SHELL?.split('/').pop() || 'sh';
      const osLabel = isWindows ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';
      const active = ctx.router.getCurrentProvider();

      console.log();
      console.log(S.accentBold('  About MyCode'));
      console.log(`  ${S.dim('─'.repeat(30))}`);
      console.log(`  Version:      v${ctx.version}`);
      console.log(`  Active model: ${S.accent(formatProvider(active))}`);
      console.log(`  OS:           ${osLabel} (${platform()})`);
      console.log(`  Shell:        ${shell}`);
      console.log(`  CWD:          ${ctx.cwd}`);
      console.log(`  Node.js:      ${process.version}`);
      console.log();
      return true;
    },
  },
  {
    name: '/memory',
    description: 'Show project memory (MYCODE.md)',
    handler: async (_args, ctx) => {
      const files = ['MYCODE.md', 'mycode.md', '.mycode.md'];
      let found = false;

      for (const file of files) {
        const path = `${ctx.cwd}/${file}`;
        if (existsSync(path)) {
          const content = readFileSync(path, 'utf-8');
          console.log();
          console.log(S.accentBold(`  Project Instructions (${file})`));
          console.log(`  ${S.dim('─'.repeat(35))}`);
          console.log(content.split('\n').map(l => `  ${l}`).join('\n'));
          console.log();
          found = true;
          break;
        }
      }

      if (!found) {
        console.log(`  ${S.dim('No MYCODE.md found. Create one to give the AI project-specific context.')}`);
      }
      return true;
    },
  },
  {
    name: '/exit',
    aliases: ['/quit', '/q'],
    description: 'Exit chat',
    handler: async () => {
      console.log(`  ${S.dim('Goodbye! 👋')}`);
      return false;
    },
  },
];

export async function handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<boolean> {
  const spaceIdx = input.indexOf(' ');
  const cmdName = (spaceIdx === -1 ? input : input.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1);

  const command = COMMANDS.find(c =>
    c.name === cmdName || c.aliases?.includes(cmdName)
  );

  if (!command) {
    console.log(`  ${S.warning(ICONS.warning)} Unknown command: ${cmdName}. Type ${S.brand('/help')} for available commands.`);
    return true;
  }

  return command.handler(args, ctx);
}

export function getCommandNames(): string[] {
  const names: string[] = [];
  for (const cmd of COMMANDS) {
    names.push(cmd.name);
    if (cmd.aliases) names.push(...cmd.aliases);
  }
  return names;
}

export function getCompletions(partial: string): { completions: string[]; displayLines: string[] } {
  const lower = partial.toLowerCase();
  const matches = COMMANDS.filter(c =>
    c.name.startsWith(lower) || c.aliases?.some(a => a.startsWith(lower))
  );

  const completions = matches.map(c => c.name + ' ');
  const displayLines = matches.map(c =>
    `  ${S.brand(c.name.padEnd(16))} ${S.dim(c.description)}`
  );

  return { completions, displayLines };
}
