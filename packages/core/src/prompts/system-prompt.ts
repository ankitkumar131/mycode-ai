import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { platform, arch, release, hostname, homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { skillManager } from '../skills/skill-manager.js';

export interface SystemPromptOptions {
  tools?: string[];
  model?: string;
  provider?: string;
  /** Include a compact index of installed skills (default true) */
  includeSkills?: boolean;
  /** Extra sections (e.g. personality overlay, loaded skills) */
  extraSections?: string[];
  /** Memory file content (~/.mycode/MEMORY.md) */
  memory?: string;
}

/** Context files searched, in priority order; the first found in each location is used. */
export const CONTEXT_FILE_NAMES = ['MYCODE.md', 'AGENTS.md', 'CLAUDE.md', '.mycode/MYCODE.md', '.cursorrules', 'GEMINI.md'];

export function findContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  // Global
  const globalFile = join(homedir(), '.mycode', 'MYCODE.md');
  if (existsSync(globalFile)) {
    try {
      const c = readFileSync(globalFile, 'utf-8').trim();
      if (c) out.push({ path: globalFile, content: c });
    } catch {
      /* ignore */
    }
  }
  // Walk from git root (or cwd) down to cwd so nested project files stack
  const chain: string[] = [];
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    chain.unshift(dir);
    const parent = resolve(dir, '..');
    if (parent === dir || existsSync(join(dir, '.git'))) break;
    dir = parent;
  }
  for (const d of chain) {
    for (const name of CONTEXT_FILE_NAMES) {
      const p = join(d, name);
      if (existsSync(p)) {
        try {
          const c = readFileSync(p, 'utf-8').trim();
          if (c) out.push({ path: p, content: c.slice(0, 20_000) });
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  return out;
}

export function readMemory(): string {
  const p = join(homedir(), '.mycode', 'MEMORY.md');
  if (!existsSync(p)) return '';
  try {
    return readFileSync(p, 'utf-8').trim().slice(0, 8000);
  } catch {
    return '';
  }
}

export class SystemPromptBuilder {
  private parts: string[] = [];

  addSection(section: string): void {
    this.parts.push(section);
  }

  build(): string {
    return this.parts.join('\n\n');
  }

  static default(): string {
    return 'You are MyCode, a multi-provider AI coding agent.';
  }

  static async buildSystemPrompt(cwd: string, options: SystemPromptOptions = {}): Promise<string> {
    const b = new SystemPromptBuilder();
    const tools = new Set(options.tools ?? []);
    const has = (t: string) => tools.size === 0 || tools.has(t);

    // ── Identity ──────────────────────────────────────────────────────────
    const modelInfo = options.model ? ` (${options.model})` : '';
    b.addSection(
      `You are MyCode${modelInfo}, an expert software-engineering agent running in the user's terminal. You work directly in their repository: you read and edit files, run commands, search the web and documents, and iterate until the task is verifiably done. Be direct, precise and honest about uncertainty.`
    );

    // ── Environment ───────────────────────────────────────────────────────
    const shell = platform() === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const envLines = [`- OS: ${platform()} ${arch()} ${release()}`, `- Host: ${hostname()}`, `- Shell: ${shell}`, `- Working directory: ${cwd}`, `- Date: ${new Date().toISOString().slice(0, 10)}`];
    if (platform() === 'win32') {
      envLines.push(`- Home / Desktop: ${process.env.USERPROFILE ?? ''} / ${process.env.USERPROFILE ?? ''}\\Desktop`);
      envLines.push('- terminal runs commands through cmd.exe. Prefer plain cmd built-ins (move, copy, dir, del, mkdir, type) with double-quoted paths. Use `powershell -NoProfile -Command "..."` only when cmd cannot do it; keep it to a single simple expression.');
    }
    b.addSection(`Environment:\n${envLines.join('\n')}`);

    // ── Project ───────────────────────────────────────────────────────────
    const projectParts: string[] = [];
    const pkgPath = resolve(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        projectParts.push(`Node package: ${pkg.name ?? '(unnamed)'}${pkg.description ? ` — ${pkg.description}` : ''}`);
        if (pkg.scripts) {
          const scripts = Object.keys(pkg.scripts).slice(0, 12);
          if (scripts.length) projectParts.push(`npm scripts: ${scripts.join(', ')}`);
        }
        const pm = existsSync(resolve(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(resolve(cwd, 'yarn.lock')) ? 'yarn' : existsSync(resolve(cwd, 'bun.lockb')) ? 'bun' : 'npm';
        projectParts.push(`Package manager: ${pm}`);
      } catch {
        /* ignore */
      }
    }
    for (const [file, label] of [
      ['pyproject.toml', 'Python project (pyproject.toml)'],
      ['requirements.txt', 'Python project (requirements.txt)'],
      ['Cargo.toml', 'Rust crate (Cargo.toml)'],
      ['go.mod', 'Go module (go.mod)'],
      ['pom.xml', 'Maven project'],
      ['build.gradle', 'Gradle project'],
      ['Gemfile', 'Ruby project'],
      ['composer.json', 'PHP project'],
      ['Makefile', 'Makefile present'],
      ['Dockerfile', 'Dockerfile present'],
    ]) {
      if (existsSync(resolve(cwd, file))) projectParts.push(label);
    }
    if (projectParts.length) b.addSection(`Project:\n${projectParts.map(p => `- ${p}`).join('\n')}`);

    // ── Git ───────────────────────────────────────────────────────────────
    const gitParts: string[] = [];
    const git = (cmd: string) => {
      try {
        return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return '';
      }
    };
    const branch = git('git branch --show-current');
    if (branch) gitParts.push(`Branch: ${branch}`);
    const status = git('git status --short');
    if (status) gitParts.push(`Uncommitted changes: ${status.split('\n').filter(Boolean).length} file(s)`);
    const log = git('git log --oneline -5');
    if (log) gitParts.push(`Recent commits:\n${log.split('\n').map(l => `  ${l}`).join('\n')}`);
    if (gitParts.length) b.addSection(`Git:\n${gitParts.join('\n')}`);

    // ── Context files (MYCODE.md / AGENTS.md / CLAUDE.md) ─────────────────
    for (const f of findContextFiles(cwd)) {
      b.addSection(`Instructions from ${f.path}:\n${f.content}`);
    }

    // ── Memory ────────────────────────────────────────────────────────────
    const memory = options.memory ?? readMemory();
    if (memory) b.addSection(`Persistent memory (from ~/.mycode/MEMORY.md — facts about the user and their preferences):\n${memory}`);

    // ── Skills index ──────────────────────────────────────────────────────
    if (options.includeSkills !== false && has('skill_view')) {
      try {
        const idx = skillManager.index(cwd);
        if (idx.length) {
          const lines = idx.slice(0, 60).map(s => `- ${s.name}${s.category ? ` [${s.category}]` : ''}: ${s.description}`);
          b.addSection(
            `Skills (reusable procedures). When a task matches one, call skill_view(name) FIRST and follow it:\n${lines.join('\n')}${idx.length > 60 ? `\n… and ${idx.length - 60} more (skills_list)` : ''}`
          );
        }
      } catch {
        /* ignore */
      }
    }

    // ── Tool guidance ─────────────────────────────────────────────────────
    const guide: string[] = [];
    if (has('read_file')) guide.push('- read_file: read source with line numbers (use offset/limit for big files). Read before you edit.');
    if (has('read_document')) guide.push('- read_document / read_pdf: extract text from PDF, Word, Excel, PowerPoint, ODF, EPUB, RTF, HTML, CSV. NEVER write a script to parse these — always use the tool.');
    if (has('glob')) guide.push('- glob: find files by pattern (e.g. "src/**/*.ts").');
    if (has('search_files')) guide.push('- search_files: regex search inside files (ripgrep-like).');
    if (has('patch')) guide.push('- patch: targeted edits — supply a unique old_string with a few lines of context. Preferred for modifying existing files.');
    if (has('write_file')) guide.push('- write_file: create new files or full rewrites only.');
    if (has('terminal')) guide.push('- terminal: run shell commands (tests, builds, git, installs). Use background=true for servers/watchers and manage them with process.');
    if (has('execute_code')) guide.push('- execute_code: run a short script (python/node/bash) when computation is easier than shell.');
    if (has('web_search')) guide.push('- web_search / web_fetch: look up current docs, errors, APIs when unsure.');
    if (has('todo_write')) guide.push('- todo_write: keep a visible checklist for multi-step tasks; update it as you go.');
    if (has('skill_manage')) guide.push('- skill_manage: after finishing a non-trivial workflow that is likely to recur, save it as a skill; patch skills that were wrong.');
    if (guide.length) b.addSection(`Tools:\n${guide.join('\n')}`);

    // ── Working rules ─────────────────────────────────────────────────────
    b.addSection(
      `Working rules:
1. Understand before acting: for greetings or simple questions reply directly — no tools. For tasks, briefly inspect relevant files (glob/search/read) before editing.
2. Make minimal, surgical changes that match the project's existing style, naming and conventions. Don't reformat unrelated code.
3. Verify: run the relevant tests/build/lint after changes and fix what you broke. Never claim something works without running it.
4. Never fabricate file contents, command output, or APIs. If a tool fails, read the error and adapt; don't retry the identical call.
5. Safety: never run destructive commands (rm -rf, git reset --hard, force-push, dropping databases) or touch secrets without an explicit request. Ask when in doubt.
6. Keep responses tight: what you did, what changed (files), how you verified, and anything the user must do next. Use markdown sparingly; paths and commands in backticks.
7. Long tasks: plan with todo_write, work step by step, and summarise at the end.
8. Trust tool results. A command that returns [exit 0 · SUCCESS] worked — do not re-check the same fact with a second command, and never verify more than once. For simple file operations (move/copy/rename/delete) run ONE command, then report.
9. Every terminal call costs the user an approval prompt: batch related steps into one command and keep the total number of commands minimal.`
    );

    for (const s of options.extraSections ?? []) b.addSection(s);

    return b.build();
  }
}
