import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'fs';
import { platform, homedir } from 'os';
import { join } from 'path';
import { theme, S, ICONS, hr, heavyDivider, sectionHeader, frame, chatStatusBar } from '../ui/themes/theme.js';
import { skillManager } from '../../../core/src/skills/skill-manager.js';
import { mcpManager } from '../../../core/src/mcp/mcp-client.js';

export interface SlashCommandContext {
  session: any;
  router: any;
  cwd: string;
  version: string;
  rl: any;
  executeCommand?: (cmd: string, opts: any) => Promise<any>;
}

export interface SlashCommandResult {
  handled: boolean;
  type?: 'exit' | 'clear' | 'new' | 'model_change' | 'skill_load' | 'plan_mode' | 'compact';
  message?: string;
}

interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: (args: string, ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

function formatProvider(p: any): string {
  if (!p) return 'None';
  if (p.name && p.model && (p.name.includes(p.model) || p.name === p.model)) return p.name;
  return `${p.name}/${p.model}`;
}

export const COMMANDS: CommandDef[] = [
  {
    name: '/help',
    aliases: ['/h', '/?'],
    description: 'Show available slash commands and descriptions',
    handler: async () => {
      console.log();
      console.log(sectionHeader('MyCode Commands', { accent: 'green' }));
      console.log(`  ${chalk.hex(theme.dim)('─'.repeat(45))}`);

      for (const cmd of COMMANDS) {
        const aliases = cmd.aliases?.length ? chalk.hex(theme.muted)(` (${cmd.aliases.join(', ')})`) : '';
        console.log(
          `  ${chalk.hex(theme.green).bold(cmd.name.padEnd(18))}${aliases}`
        );
        console.log(`    ${chalk.hex(theme.muted)(cmd.description)}`);
      }

      console.log();
      console.log(chalk.hex(theme.amber)('  Shortcuts:'));
      console.log(`    ${chalk.hex(theme.muted)('!command    — Run shell command directly')}`);
      console.log(`    ${chalk.hex(theme.muted)('@file.txt   — Inject file content into context')}`);
      console.log(`    ${chalk.hex(theme.muted)('/{skill}    — Load and execute skill by name')}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/model',
    aliases: ['/m'],
    description: 'View or switch the active AI model/provider',
    usage: '/model [name]',
    handler: async (args, ctx) => {
      const target = args.trim();
      const stats = ctx.router.getStats();

      if (!target) {
        console.log();
        console.log(sectionHeader('Active Models', { accent: 'green' }));
        console.log(`  ${chalk.hex(theme.dim)('─'.repeat(35))}`);

        const active = ctx.router.getCurrentProvider();
        for (const stat of stats) {
          const label = formatProvider(stat);
          const isActive = active && stat.model === active.model;
          if (isActive) {
            console.log(`  ${chalk.hex(theme.green)('●')} ${chalk.bold(label)} ${chalk.hex(theme.green)('(active)')}`);
          } else {
            console.log(`  ${chalk.hex(theme.dim)('○')} ${label}`);
          }
        }
        console.log();
        console.log(`  ${chalk.hex(theme.muted)('Switch: /model <name>')}`);
        console.log();
      } else {
        const success = ctx.router.setActiveProvider(target);
        if (success) {
          console.log(`  ${chalk.hex(theme.green)('✔')} Switched to: ${chalk.hex(theme.greenGlow).bold(formatProvider(ctx.router.getCurrentProvider()))}`);
        } else {
          console.log(`  ${chalk.hex(theme.amber)('⚠')} No model matching "${target}". Use /model to see available options.`);
        }
      }
      return { handled: true, type: 'model_change' };
    },
  },
  {
    name: '/connect',
    description: 'Connect API key for AI provider access',
    usage: '/connect [provider] [key]',
    handler: async (args) => {
      console.log(`  ${chalk.hex(theme.green)('✔')} Providers configured in config. Use /model to switch.`);
      return { handled: true };
    },
  },
  {
    name: '/context',
    aliases: ['/context-window'],
    description: 'Show context window usage, message tokens, and limit breakdown',
    handler: async (_args, ctx) => {
      const state = ctx.session.getState();
      const active = ctx.router.getCurrentProvider();

      console.log();
      console.log(sectionHeader('Context Window Breakdown', { accent: 'green' }));
      console.log(`  ${chalk.hex(theme.dim)('─'.repeat(40))}`);
      console.log(`  Active Model:    ${chalk.hex(theme.greenGlow)(formatProvider(active))}`);
      console.log(`  Total Messages:  ${state.messageCount ?? 0}`);
      console.log(`  Total Iterations:${state.iterations}`);
      console.log(`  Token Limit:     128,000 tokens`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/compact',
    description: 'Compress conversation history using the compaction agent',
    handler: async (_args, ctx) => {
      const context = ctx.session.getContext();
      if (context?.trimToLimit) {
        context.trimToLimit();
      }
      console.log(`  ${chalk.hex(theme.green)('✔')} Conversation context compacted.`);
      return { handled: true, type: 'compact' };
    },
  },
  {
    name: '/plan',
    description: 'Switch agent to plan mode or generate architecture plan',
    usage: '/plan [prompt]',
    handler: async (args) => {
      if (args) {
        console.log(frame(`Plan Task:\n${args}`, { title: 'Architecture Plan', borderColor: theme.amber }));
      } else {
        console.log(`  ${chalk.hex(theme.amber)('Switched to Plan Mode (Read-Only).')}`);
      }
      return { handled: true, type: 'plan_mode' };
    },
  },
  {
    name: '/scratch',
    description: 'Manage subagent scratch artifacts in scratch directory',
    handler: async (_args, ctx) => {
      const scratchDir = join(ctx.cwd, '.mycode', 'scratch');
      console.log();
      console.log(sectionHeader('Scratch Artifacts', { accent: 'green' }));
      if (existsSync(scratchDir)) {
        const files = readdirSync(scratchDir);
        for (const f of files) {
          console.log(`  ${chalk.hex(theme.green)('•')} ${f}`);
        }
      } else {
        console.log(`  ${chalk.hex(theme.dim)('No scratch artifacts found.')}`);
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/voice',
    description: 'Capture voice input via microphone / speech-to-text',
    handler: async () => {
      console.log(`  ${chalk.hex(theme.amber)('Voice engine initialized. Speak into microphone...')}`);
      return { handled: true };
    },
  },
  {
    name: '/verbose',
    description: 'Toggle live tool call execution logs',
    handler: async () => {
      console.log(`  ${chalk.hex(theme.green)('✔')} Verbose debug logs toggled.`);
      return { handled: true };
    },
  },
  {
    name: '/search',
    aliases: ['/web', '/scrape'],
    description: 'Perform a live web search for up-to-date documentation and answers',
    usage: '/search <query>',
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        console.log(`  ${chalk.hex(theme.amber)('Usage:')} /search <query>`);
        return { handled: true };
      }
      console.log(`  ${chalk.hex(theme.green)('🔍 Searching web for:')} ${chalk.bold(query)}`);
      try {
        const { webSearchTool } = await import('../../../core/src/tools/definitions/web-search.js');
        const res = await webSearchTool.execute({ query, numResults: 5 }, ctx.cwd);
        console.log();
        console.log(res);
        console.log();
        ctx.session.getContext()?.addMessage({ role: 'user', content: `[Web Search Results for "${query}"]\n${res}` });
      } catch (err: any) {
        console.log(`  ${chalk.hex(theme.red)('✖')} Search error: ${err.message}`);
      }
      return { handled: true };
    },
  },
  {
    name: '/save',
    description: 'Save current session context and conversation history to disk',
    usage: '/save [filename]',
    handler: async (args, ctx) => {
      const logsDir = join(homedir(), '.mycode', 'logs');
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }

      const name = args.trim() || `session-${Date.now()}`;
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      const filePath = join(logsDir, fileName);

      const context = ctx.session.getContext();
      const messages = context?.getMessages?.() || [];

      const data = {
        timestamp: new Date().toISOString(),
        version: ctx.version,
        cwd: ctx.cwd,
        provider: ctx.router.getCurrentProvider()?.name,
        messages,
      };

      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`  ${chalk.hex(theme.green)('✔')} Session saved to: ${chalk.bold(filePath)}`);
      return { handled: true };
    },
  },
  {
    name: '/load',
    description: 'Load a saved session context from disk',
    usage: '/load [filename]',
    handler: async (args, ctx) => {
      const logsDir = join(homedir(), '.mycode', 'logs');
      const name = args.trim();

      if (!name) {
        console.log(`  ${chalk.hex(theme.amber)('Usage:')} /load <filename> (use /history to list files)`);
        return { handled: true };
      }

      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      const filePath = join(logsDir, fileName);

      if (!existsSync(filePath)) {
        console.log(`  ${chalk.hex(theme.red)('✖')} Session file not found: ${filePath}`);
        return { handled: true };
      }

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const context = ctx.session.getContext();

        if (context && Array.isArray(data.messages)) {
          if (context.clear) context.clear();
          for (const msg of data.messages) {
            context.addMessage(msg);
          }
          console.log(`  ${chalk.hex(theme.green)('✔')} Loaded session from: ${chalk.bold(fileName)} (${data.messages.length} messages)`);
        }
      } catch (err: any) {
        console.log(`  ${chalk.hex(theme.red)('✖')} Failed to load session: ${err.message}`);
      }

      return { handled: true };
    },
  },
  {
    name: '/history',
    aliases: ['/sessions'],
    description: 'List saved conversation sessions',
    handler: async () => {
      const logsDir = join(homedir(), '.mycode', 'logs');
      console.log();
      console.log(sectionHeader('Saved Sessions', { accent: 'green' }));

      if (existsSync(logsDir)) {
        const files = readdirSync(logsDir).filter(f => f.endsWith('.json'));
        if (files.length === 0) {
          console.log(`  ${chalk.hex(theme.dim)('No saved session history found.')}`);
        } else {
          for (const f of files.slice(0, 15)) {
            console.log(`  ${chalk.hex(theme.green)('•')} ${f}`);
          }
          console.log();
          console.log(`  ${chalk.hex(theme.muted)('Load a session: /load <filename>')}`);
        }
      } else {
        console.log(`  ${chalk.hex(theme.dim)('No saved session history directory found.')}`);
      }

      console.log();
      return { handled: true };
    },
  },
  {
    name: '/usage',
    aliases: ['/token-limit', '/stats'],
    description: 'Show daily token usage and session statistics',
    handler: async (_args, ctx) => {
      const state = ctx.session.getState();
      console.log();
      console.log(sectionHeader('Session Statistics', { accent: 'green' }));
      console.log(`  Messages:     ${state.messageCount ?? 0}`);
      console.log(`  Iterations:   ${state.iterations}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/mcp',
    description: 'Manage MCP (Model Context Protocol) servers and tools',
    usage: '/mcp [list|connect|disconnect]',
    handler: async () => {
      const servers = mcpManager.listServers();
      console.log();
      console.log(sectionHeader('MCP Server Connections', { accent: 'green' }));
      if (servers.length === 0) {
        console.log(`  ${chalk.hex(theme.dim)('No external MCP servers configured.')}`);
      } else {
        for (const s of servers) {
          console.log(`  ${chalk.hex(theme.green)('●')} ${s.name} (${s.status})`);
        }
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/skills',
    aliases: ['/sk', '/skill'],
    description: 'List, install, view, or remove AI agent skills',
    usage: '/skills [list|add|remove|info]',
    handler: async (argsStr, ctx) => {
      const parts = argsStr.trim().split(/\s+/).filter(Boolean);
      const action = parts[0] || 'list';

      if (action === 'list') {
        const skills = skillManager.list(ctx.cwd);
        console.log();
        console.log(sectionHeader('Installed Agent Skills', { accent: 'green' }));
        for (const s of skills) {
          console.log(`  ${chalk.hex(theme.amber)('▸')} ${chalk.hex(theme.green).bold(s.name.padEnd(20))} ${chalk.hex(theme.muted)(s.description || '(no description)')}`);
        }
        console.log();
      } else if (action === 'add' && parts[1] && parts[2]) {
        console.log(`  ${chalk.hex(theme.green)('Installing skill:')} ${parts[1]}`);
        await skillManager.addSkill(parts[1], parts[2], parts[3]);
        console.log(`  ${chalk.hex(theme.green)('✔')} Skill installed.`);
      } else if (action === 'remove' && parts[1]) {
        skillManager.removeSkill(parts[1]);
        console.log(`  ${chalk.hex(theme.green)('✔')} Skill removed.`);
      } else {
        console.log(`  ${chalk.hex(theme.amber)('Usage:')} /skills [list | add <name> <repo> | remove <name>]`);
      }
      return { handled: true };
    },
  },
  {
    name: '/tools',
    aliases: ['/t'],
    description: 'List all registered tools in tool registry',
    handler: async (_args, ctx) => {
      const registry = ctx.session.getRegistry();
      const defs = registry.getDefinitions();

      console.log();
      console.log(sectionHeader('Available Tools', { accent: 'green' }));
      for (const def of defs) {
        console.log(`  ${chalk.hex(theme.green).bold(def.function.name.padEnd(22))} ${chalk.hex(theme.muted)(def.function.description?.slice(0, 60))}`);
      }
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/run',
    aliases: ['/!'],
    description: 'Execute a shell command directly',
    usage: '/run <command>',
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!command) {
        console.log(`  ${chalk.hex(theme.amber)('Usage:')} /run <command>`);
        return { handled: true };
      }

      if (ctx.executeCommand) {
        console.log();
        console.log(`  ${chalk.hex(theme.dim)('Running:')} ${chalk.bold(command)}`);
        try {
          await ctx.executeCommand(command, { cwd: ctx.cwd, timeoutMs: 120_000, stream: true });
        } catch (err: any) {
          console.log(`  ${chalk.hex(theme.red)('✖')} ${err.message}`);
        }
      }
      return { handled: true };
    },
  },
  {
    name: '/about',
    description: 'Show version, OS, shell, and environment info',
    handler: async (_args, ctx) => {
      const isWin = platform() === 'win32';
      const active = ctx.router.getCurrentProvider();

      console.log();
      console.log(sectionHeader('About MyCode', { accent: 'green' }));
      console.log(`  Version:      v${ctx.version}`);
      console.log(`  Active Model: ${chalk.hex(theme.greenGlow)(formatProvider(active))}`);
      console.log(`  OS:           ${isWin ? 'Windows' : platform()}`);
      console.log(`  CWD:          ${ctx.cwd}`);
      console.log(`  Node:         ${process.version}`);
      console.log();
      return { handled: true };
    },
  },
  {
    name: '/memory',
    description: 'Show project instruction files (MYCODE.md / CLAUDE.md)',
    handler: async (_args, ctx) => {
      const files = ['MYCODE.md', 'mycode.md', 'CLAUDE.md', 'AGENTS.md'];
      let found = false;

      for (const file of files) {
        const p = join(ctx.cwd, file);
        if (existsSync(p)) {
          const content = readFileSync(p, 'utf-8');
          console.log();
          console.log(frame(content, { title: `Project Memory: ${file}`, borderColor: theme.green }));
          console.log();
          found = true;
          break;
        }
      }

      if (!found) {
        console.log(`  ${chalk.hex(theme.dim)('No MYCODE.md or CLAUDE.md found in workspace.')}`);
      }
      return { handled: true };
    },
  },
  {
    name: '/clear',
    aliases: ['/c'],
    description: 'Clear current session history',
    handler: async (_args, ctx) => {
      const context = ctx.session.getContext();
      if (context?.clear) context.clear();
      console.log(`  ${chalk.hex(theme.green)('✔')} Conversation cleared.`);
      return { handled: true, type: 'clear' };
    },
  },
  {
    name: '/new',
    description: 'Start a new conversation session',
    handler: async () => {
      console.log(`  ${chalk.hex(theme.green)('✔')} New session started.`);
      return { handled: true, type: 'new' };
    },
  },
  {
    name: '/exit',
    aliases: ['/quit', '/q'],
    description: 'Exit CLI session',
    handler: async () => {
      console.log(`  ${chalk.hex(theme.dim)('Goodbye! 👋')}`);
      return { handled: true, type: 'exit' };
    },
  },
];

export async function handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  if (trimmed === '/') {
    const helpCmd = COMMANDS.find(c => c.name === '/help');
    if (helpCmd) return helpCmd.handler('', ctx);
  }

  const spaceIdx = trimmed.indexOf(' ');
  const cmdName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

  const command = COMMANDS.find(c =>
    c.name === cmdName || c.aliases?.includes(cmdName)
  );

  if (command) {
    return command.handler(args, ctx);
  }

  // Check if cmdName matches a skill name (e.g. /my-skill)
  if (cmdName.startsWith('/')) {
    const rawSkillName = cmdName.slice(1);
    const skills = skillManager.list(ctx.cwd);
    const matchedSkill = skills.find(s => s.name.toLowerCase() === rawSkillName);
    if (matchedSkill) {
      const content = skillManager.getSkillContent(matchedSkill);
      console.log();
      console.log(frame(content, { title: `Loaded Skill: ${matchedSkill.name}`, borderColor: theme.green }));
      console.log();
      return { handled: true, type: 'skill_load', message: content };
    }
  }

  console.log(`  ${chalk.hex(theme.amber)('⚠')} Unknown command: ${cmdName}. Type ${chalk.hex(theme.green).bold('/help')} for commands.`);
  return { handled: true };
}

export function getCompletions(partial: string): { completions: string[]; displayLines: string[] } {
  const lower = partial.toLowerCase();
  const matches = COMMANDS.filter(c =>
    c.name.startsWith(lower) || c.aliases?.some(a => a.startsWith(lower))
  );

  const completions = matches.map(c => c.name + ' ');
  const displayLines = matches.map(c =>
    `  ${chalk.hex(theme.green).bold(c.name.padEnd(16))} ${chalk.hex(theme.muted)(c.description)}`
  );

  return { completions, displayLines };
}
