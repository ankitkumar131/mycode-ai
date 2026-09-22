/**
 * System Prompt — Claude Code-powerful, token-efficient
 * 
 * Optimizations:
 * - Skills index 60→10 (token cut)
 * - Git log -5→-2
 * - MEMORY 8000→2000
 * - Context files 20k→8k
 * - Tool guidance compact
 * - Working rules concise
 * - Environment minimal
 * 
 * Total: ~60% token reduction vs original
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { platform, arch, hostname } from 'node:os';
import { execSync } from 'node:child_process';
import { skillManager } from '../skills/skill-manager.js';

export interface SystemPromptOptions {
  tools?: string[];
  model?: string;
  provider?: string;
  includeSkills?: boolean;
  extraSections?: string[];
  memory?: string;
}

export const CONTEXT_FILE_NAMES = ['MYCODE.md', 'AGENTS.md', 'CLAUDE.md', '.mycode/MYCODE.md', '.cursorrules', 'GEMINI.md'];

export function findContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const globalFile = join(process.env.HOME || '', '.mycode', 'MYCODE.md');
  if (existsSync(globalFile)) {
    try {
      const c = readFileSync(globalFile, 'utf-8').trim();
      if (c) out.push({ path: globalFile, content: c.slice(0, 8000) }); // 20k→8k
    } catch {}
  }
  const chain: string[] = [];
  let dir = cwd;
  for (let i = 0; i < 4; i++) { // 6→4 levels
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
          if (c) out.push({ path: p, content: c.slice(0, 8000) }); // 20k→8k
        } catch {}
        break;
      }
    }
  }
  return out;
}

export function readMemory(): string {
  const p = join(process.env.HOME || '', '.mycode', 'MEMORY.md');
  if (!existsSync(p)) return '';
  try {
    return readFileSync(p, 'utf-8').trim().slice(0, 2000); // 8000→2000
  } catch {
    return '';
  }
}

export class SystemPromptBuilder {
  private parts: string[] = [];
  addSection(section: string): void { this.parts.push(section); }
  build(): string { return this.parts.join('\n\n'); }
  static default(): string { return 'You are MyCode, AI coding agent.'; }

  static async buildSystemPrompt(cwd: string, options: SystemPromptOptions = {}): Promise<string> {
    const b = new SystemPromptBuilder();
    const tools = new Set(options.tools ?? []);
    const has = (t: string) => tools.size === 0 || tools.has(t);

    // Identity — compact
    const modelInfo = options.model ? ` (${options.model})` : '';
    b.addSection(`You are MyCode${modelInfo}, expert coding agent. Work in user's repo: read/edit files, run commands, iterate until done. Direct, precise, honest.`);

    // Environment — minimal
    const envLines = [
      `- OS: ${platform()} ${arch()} | Host: ${hostname()}`,
      `- CWD: ${cwd} | Date: ${new Date().toISOString().slice(0, 10)}`,
    ];
    b.addSection(envLines.join('\n'));

    // Project — compact
    const projectParts: string[] = [];
    const pkgPath = resolve(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        projectParts.push(`Node: ${pkg.name ?? '(unnamed)'}`);
        if (pkg.scripts) {
          const scripts = Object.keys(pkg.scripts).slice(0, 8); // 12→8
          if (scripts.length) projectParts.push(`scripts: ${scripts.join(', ')}`);
        }
      } catch {}
    }
    for (const [file, label] of [
      ['pyproject.toml', 'Python'],
      ['Cargo.toml', 'Rust'],
      ['go.mod', 'Go'],
      ['Dockerfile', 'Docker'],
    ]) {
      if (existsSync(resolve(cwd, file))) projectParts.push(label);
    }
    if (projectParts.length) b.addSection(`Project: ${projectParts.join(' | ')}`);

    // Git — minimal, log -5→-2
    const gitParts: string[] = [];
    const git = (cmd: string) => {
      try { return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
    };
    const branch = git('git branch --show-current');
    if (branch) gitParts.push(`Branch: ${branch}`);
    const status = git('git status --short');
    if (status) gitParts.push(`Uncommitted: ${status.split('\n').filter(Boolean).length} files`);
    const log = git('git log --oneline -2'); // 5→2
    if (log) gitParts.push(`Recent: ${log.split('\n').join(' | ')}`);
    if (gitParts.length) b.addSection(gitParts.join('\n'));

    // Context files
    for (const f of findContextFiles(cwd)) {
      b.addSection(`From ${f.path}:\n${f.content}`);
    }

    // Memory — 2000 chars
    const memory = options.memory ?? readMemory();
    if (memory) b.addSection(`Memory: ${memory}`);

    // Skills index — 60→10
    if (options.includeSkills !== false && has('skill_view')) {
      try {
        const idx = skillManager.index(cwd);
        if (idx.length) {
          const lines = idx.slice(0, 10).map(s => `- ${s.name}: ${s.description.slice(0, 60)}`);
          b.addSection(`Skills (skill_view first):\n${lines.join('\n')}${idx.length > 10 ? `\n…+${idx.length - 10} more (skills_list)` : ''}`);
        }
      } catch {}
    }

    // Tool guidance — compact, includes new tools
    const guide: string[] = [];
    if (has('read_file')) guide.push('read_file: token-efficient, modes=content/outline/summary, default 100 lines');
    if (has('codebase_map')) guide.push('codebase_map: Graft-inspired, use FIRST before grep — reduces 46% calls');
    if (has('codebase_search')) guide.push('codebase_search: semantic search over graph');
    if (has('impact_analysis')) guide.push('impact_analysis: blast radius before edit');
    if (has('memory_recall')) guide.push('memory_recall: recall past work, token-budgeted 2000');
    if (has('delegate_to_specialist')) guide.push('delegate_to_specialist: Agency-Agents, auto-routing to experts');
    if (has('browser_navigate')) guide.push('browser: navigate→snapshot→act pattern, self-healing');
    if (has('patch')) guide.push('patch: targeted edits, unique old_string');
    if (has('write_file')) guide.push('write_file: atomic, batch support');
    if (has('terminal')) guide.push('terminal: batch with &&, smart-truncate, auto-approve ro');
    if (has('todo_write')) guide.push('todo_write: persistent, deps, verification');
    if (guide.length) b.addSection(`Tools:\n${guide.map(g => `- ${g}`).join('\n')}`);

    // Working rules — concise, Claude Code style
    b.addSection(
      `Rules:
1. Understand before act: simple Q → direct answer, tasks → inspect (codebase_map first, then read)
2. Minimal surgical changes, match style, no unrelated reformats
3. Verify: run tests/build after changes, fix breaks, don't claim without running
4. No fabrication: if tool fails, read error and adapt
5. Safety: no destructive (rm -rf, reset --hard, force-push) without explicit ask
6. Tight responses: what done, files changed, how verified, next steps
7. Long tasks: todo_write plan→execute→verify
8. Trust tool results: exit 0 = success, don't re-check
9. Batch terminal calls (&&) to minimize approvals
10. Token-efficient: use outline mode, codebase_map, memory_recall`
    );

    for (const s of options.extraSections ?? []) b.addSection(s);

    return b.build();
  }
}
