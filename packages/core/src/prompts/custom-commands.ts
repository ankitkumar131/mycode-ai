/**
 * User-defined slash commands loaded from markdown.
 *
 * Drop a file in `.mycode/commands/` (project) or `~/.mycode/commands/` (user)
 * and it becomes a slash command:
 *
 *   ---
 *   description: Review a file for bugs
 *   argument-hint: <path>
 *   ---
 *   Read $1 carefully and report bugs with file:line references.
 *   Extra notes: $ARGUMENTS
 *
 * This mirrors how opencode, Claude Code and similar tools let a project ship
 * its own prompts, so a repository already set up for one of them mostly works
 * here: the loader also reads `.opencode/command/` and `.claude/commands/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseFrontmatter } from '../skills/skill-loader.js';

export interface CustomCommand {
  /** Includes the leading slash, e.g. `/review`. */
  name: string;
  description: string;
  argumentHint?: string;
  template: string;
  /** Absolute path, shown by `/help` and useful for debugging. */
  source: string;
  /** 'project' shadows 'user' when names collide. */
  scope: 'project' | 'user';
}

/** Directories searched, in increasing order of precedence. */
const PROJECT_DIRS = [
  '.mycode/commands',
  '.opencode/command',
  '.claude/commands',
];
const USER_DIRS = [
  '.mycode/commands',
  join('.config', 'opencode', 'command'),
  join('.claude', 'commands'),
];

const MAX_COMMANDS = 200;

function parseFile(path: string, scope: 'project' | 'user'): CustomCommand | null {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  const fm = parseFrontmatter(content);
  // Strip the frontmatter block; the rest is the prompt template.
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  if (!body) return null;

  const name = `/${fm.name ?? basename(path).replace(/\.md$/i, '')}`;
  // A slash command name has to survive being typed; refuse anything odd.
  if (!/^\/[a-z0-9][a-z0-9_-]*$/i.test(name)) return null;

  const rawHint = fm.raw?.argumentHint ?? fm.raw?.['argument-hint'];
  return {
    name,
    description: fm.description ?? 'Custom command',
    argumentHint: typeof rawHint === 'string' ? rawHint : undefined,
    template: body,
    source: path,
    scope,
  };
}

function readDir(dir: string, scope: 'project' | 'user', out: CustomCommand[]): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_COMMANDS) return;
    if (!entry.toLowerCase().endsWith('.md')) continue;
    const full = join(dir, entry);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const cmd = parseFile(full, scope);
    if (cmd) out.push(cmd);
  }
}

/**
 * Load custom commands, nearest-wins: a project command shadows a user command
 * of the same name, and a later directory in the list shadows an earlier one.
 */
export function loadCustomCommands(cwd: string): CustomCommand[] {
  const byName = new Map<string, CustomCommand>();

  for (const rel of USER_DIRS) {
    const dir = join(homedir(), rel);
    const found: CustomCommand[] = [];
    readDir(dir, 'user', found);
    for (const c of found) byName.set(c.name, c);
  }
  for (const rel of PROJECT_DIRS) {
    const dir = join(cwd, rel);
    const found: CustomCommand[] = [];
    readDir(dir, 'project', found);
    for (const c of found) byName.set(c.name, c);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Expand a command template.
 *
 * `$ARGUMENTS` is the whole argument string. `$1`..`$9` are positional
 * arguments, shell-style: quoted runs count as one argument, and `$@` is every
 * argument as a space-separated list.
 */
export function expandCustomCommand(template: string, argumentString: string): string {
  const args = splitArgs(argumentString);
  return template
    // (?!\w) rather than \b: `$@` ends with a non-word character, so a word
    // boundary can never follow it.
    .replace(/\$ARGUMENTS(?!\w)/g, argumentString)
    .replace(/\$@(?!\w)/g, args.join(' '))
    .replace(/\$([1-9])(?!\d)/g, (_m, d: string) => args[Number(d) - 1] ?? '');
}

/** Shell-ish splitting: respects single and double quotes. */
function splitArgs(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Look up one command by name (with or without the leading slash). */
export function findCustomCommand(cwd: string, name: string): CustomCommand | undefined {
  const wanted = name.startsWith('/') ? name : `/${name}`;
  return loadCustomCommands(cwd).find((c) => c.name.toLowerCase() === wanted.toLowerCase());
}
