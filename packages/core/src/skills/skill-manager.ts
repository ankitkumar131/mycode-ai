/**
 * SkillManager — Hermes-style skills system.
 *
 * Skill sources (priority order; first wins on name collisions):
 *   1. Workspace   <cwd>/.mycode/skills, <cwd>/.agents/skills, <cwd>/skills
 *   2. User        ~/.mycode/skills          (primary — hub installs, agent-created, bundled seed)
 *   3. External    MYCODE_SKILL_DIRS (path-separated) or config.skills.externalDirs
 *
 * Progressive disclosure:
 *   Level 0  index()            → [{name, description, category}]
 *   Level 1  view(name)         → SKILL.md body
 *   Level 2  view(name, file)   → a reference file inside the skill
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync } from 'fs';
import { join, resolve, relative, isAbsolute, dirname, delimiter } from 'path';
import { homedir } from 'os';
import { SkillLoader, stripFrontmatter, isPlatformCompatible, listSkillFiles } from './skill-loader.js';
import { BUNDLED_SKILLS } from './bundled-skills.js';
import type { InstalledSkill, SkillDefinition, SkillsLockFile, SkillIndexEntry } from './types.js';

export interface SkillManagerOptions {
  /** Override ~/.mycode (mostly for tests). */
  homeDir?: string;
  /** Extra directories to scan. */
  externalDirs?: string[];
  /** Skip the bundled-skill seeding step. */
  noBundled?: boolean;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  source: string;
  installUrl?: string;
  path?: string;
}

const HUB_REPOS = [
  // owner/repo, skills folder
  { repo: 'NousResearch/hermes-agent', dir: 'skills' },
  { repo: 'anthropics/skills', dir: 'skills' },
];

export class SkillManager {
  private loader = new SkillLoader();
  private opts: SkillManagerOptions;
  private cache: { key: string; skills: InstalledSkill[]; ts: number } | null = null;

  constructor(opts: SkillManagerOptions = {}) {
    this.opts = opts;
  }

  // ─── Paths ────────────────────────────────────────────────────────────────

  /** Update options at runtime (e.g. after config load). */
  configure(opts: SkillManagerOptions): void {
    this.opts = { ...this.opts, ...opts };
    this.invalidate();
  }

  getHomeDir(): string {
    return this.opts.homeDir ?? join(homedir(), '.mycode');
  }

  getSkillsDir(): string {
    return join(this.getHomeDir(), 'skills');
  }

  getLockFilePath(): string {
    return join(this.getHomeDir(), 'skills-lock.json');
  }

  getWorkspaceSkillDirs(workspaceRoot: string): string[] {
    return [
      join(workspaceRoot, '.mycode', 'skills'),
      join(workspaceRoot, '.agents', 'skills'),
      join(workspaceRoot, '.claude', 'skills'),
      join(workspaceRoot, 'skills'),
    ];
  }

  getExternalDirs(): string[] {
    const fromEnv = (process.env.MYCODE_SKILL_DIRS ?? '').split(delimiter).filter(Boolean);
    return [...(this.opts.externalDirs ?? []), ...fromEnv].map(d => resolve(d.replace(/^~(?=$|[\\/])/, homedir())));
  }

  // ─── Lock file ────────────────────────────────────────────────────────────

  readLockFile(): SkillsLockFile {
    const lockPath = this.getLockFilePath();
    if (!existsSync(lockPath)) return { version: 1, skills: {} };
    try {
      return JSON.parse(readFileSync(lockPath, 'utf-8'));
    } catch {
      return { version: 1, skills: {} };
    }
  }

  writeLockFile(lock: SkillsLockFile): void {
    mkdirSync(this.getHomeDir(), { recursive: true });
    writeFileSync(this.getLockFilePath(), JSON.stringify(lock, null, 2), 'utf-8');
  }

  // ─── Bundled seeding ──────────────────────────────────────────────────────

  /** Copy bundled skills into ~/.mycode/skills if they're not there yet. Idempotent. */
  seedBundledSkills(): string[] {
    if (this.opts.noBundled) return [];
    const dir = this.getSkillsDir();
    if (existsSync(join(this.getHomeDir(), '.no-bundled-skills'))) return [];
    const seeded: string[] = [];
    for (const b of BUNDLED_SKILLS) {
      const target = join(dir, b.name);
      if (existsSync(join(target, 'SKILL.md'))) continue;
      for (const [rel, content] of Object.entries(b.files)) {
        const p = join(target, rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content, 'utf-8');
      }
      seeded.push(b.name);
    }
    if (seeded.length) this.invalidate();
    return seeded;
  }

  /** Restore a bundled skill to its shipped content. */
  resetBundledSkill(name: string): boolean {
    const b = BUNDLED_SKILLS.find(s => s.name === name);
    if (!b) return false;
    const target = join(this.getSkillsDir(), b.name);
    rmSync(target, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(b.files)) {
      const p = join(target, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf-8');
    }
    this.invalidate();
    return true;
  }

  getBundledNames(): string[] {
    return BUNDLED_SKILLS.map(b => b.name);
  }

  // ─── Discovery ────────────────────────────────────────────────────────────

  invalidate(): void {
    this.cache = null;
  }

  list(workspaceRoot?: string, opts: { includeIncompatible?: boolean } = {}): InstalledSkill[] {
    const key = `${workspaceRoot ?? ''}|${opts.includeIncompatible ? 1 : 0}`;
    if (this.cache && this.cache.key === key && Date.now() - this.cache.ts < 2000) {
      return this.cache.skills;
    }

    const skills: InstalledSkill[] = [];
    const seen = new Set<string>();
    const add = (list: InstalledSkill[]) => {
      for (const s of list) {
        const k = s.name.toLowerCase();
        if (seen.has(k)) continue;
        if (!opts.includeIncompatible && !isPlatformCompatible(s.platforms)) continue;
        seen.add(k);
        skills.push(s);
      }
    };

    if (workspaceRoot) {
      for (const d of this.getWorkspaceSkillDirs(workspaceRoot)) {
        add(this.loader.loadFromDirectory(d, 'workspace'));
      }
    }
    add(this.loader.loadFromDirectory(this.getSkillsDir(), 'user'));
    for (const d of this.getExternalDirs()) {
      add(this.loader.loadFromDirectory(d, 'external'));
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    this.cache = { key, skills, ts: Date.now() };
    return skills;
  }

  /** Level 0: compact index for the system prompt / skills_list tool. */
  index(workspaceRoot?: string): SkillIndexEntry[] {
    return this.list(workspaceRoot).map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
      tags: s.tags.length ? s.tags : undefined,
      origin: s.origin,
    }));
  }

  find(name: string, workspaceRoot?: string): InstalledSkill | undefined {
    const n = name.trim().replace(/^\//, '').toLowerCase();
    return this.list(workspaceRoot).find(s => s.name.toLowerCase() === n);
  }

  /** Fuzzy match used by the slash-command menu. */
  match(prefix: string, workspaceRoot?: string): InstalledSkill[] {
    const p = prefix.trim().replace(/^\//, '').toLowerCase();
    if (!p) return this.list(workspaceRoot);
    return this.list(workspaceRoot).filter(
      s => s.name.toLowerCase().startsWith(p) || s.name.toLowerCase().includes(p) || s.tags.some(t => t.toLowerCase().startsWith(p))
    );
  }

  // ─── Content (Level 1 / 2) ────────────────────────────────────────────────

  getSkillContent(skill: InstalledSkill): string {
    if (!existsSync(skill.localPath)) return '';
    return stripFrontmatter(readFileSync(skill.localPath, 'utf-8'));
  }

  /** Full SKILL.md including frontmatter. */
  getSkillRaw(skill: InstalledSkill): string {
    if (!existsSync(skill.localPath)) return '';
    return readFileSync(skill.localPath, 'utf-8');
  }

  /**
   * View a skill or one of its files.
   * @param filePath  relative path inside the skill directory (e.g. "references/api.md")
   */
  view(name: string, filePath?: string, workspaceRoot?: string): string {
    const skill = this.find(name, workspaceRoot);
    if (!skill) {
      const suggestions = this.match(name, workspaceRoot).slice(0, 5).map(s => s.name);
      throw new Error(`Skill "${name}" not found.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`);
    }
    if (filePath) {
      const target = this.safeJoin(skill.dir, filePath);
      if (!existsSync(target)) throw new Error(`File "${filePath}" not found in skill "${skill.name}". Available: ${skill.files.join(', ') || '(none)'}`);
      const st = statSync(target);
      if (st.isDirectory()) {
        return readdirSync(target).map(f => join(filePath, f)).join('\n');
      }
      if (st.size > 500_000) throw new Error(`File too large (${(st.size / 1024).toFixed(0)} KB).`);
      return readFileSync(target, 'utf-8');
    }
    const header = [
      `# Skill: ${skill.name}`,
      skill.description ? `Description: ${skill.description}` : '',
      skill.category ? `Category: ${skill.category}` : '',
      skill.tags.length ? `Tags: ${skill.tags.join(', ')}` : '',
      `Location: ${skill.dir}`,
      skill.files.length ? `Files: ${skill.files.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return `${header}\n\n${this.getSkillContent(skill)}`;
  }

  /**
   * Build the message injected into the conversation when the user runs
   * `/<skill> [args]`.
   */
  buildInvocation(skill: InstalledSkill, args: string): string {
    const content = this.getSkillContent(skill);
    const filesNote = skill.files.length
      ? `\nAdditional files in this skill (load with skill_view name="${skill.name}" path="<file>"): ${skill.files.join(', ')}`
      : '';
    const task = args.trim()
      ? `\n\nUser request:\n${args.trim()}`
      : `\n\nThe user invoked this skill without a specific request. Briefly explain what it does and ask what they need, unless the skill body says otherwise.`;
    return `<skill name="${skill.name}">\n${content}${filesNote}\n</skill>${task}`;
  }

  // ─── Management (create / edit / delete) ─────────────────────────────────

  createSkill(name: string, content: string, opts: { overwrite?: boolean; workspaceRoot?: string; scope?: 'user' | 'workspace' } = {}): string {
    const safe = this.validateName(name);
    const base = opts.scope === 'workspace' && opts.workspaceRoot ? join(opts.workspaceRoot, '.mycode', 'skills') : this.getSkillsDir();
    const dir = join(base, safe);
    const file = join(dir, 'SKILL.md');
    if (existsSync(file) && !opts.overwrite) {
      throw new Error(`Skill "${safe}" already exists at ${file}. Use action=edit or overwrite=true.`);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, this.ensureFrontmatter(safe, content), 'utf-8');
    this.invalidate();
    return file;
  }

  editSkill(name: string, content: string, workspaceRoot?: string): string {
    const skill = this.find(name, workspaceRoot);
    if (!skill) throw new Error(`Skill "${name}" not found.`);
    writeFileSync(skill.localPath, this.ensureFrontmatter(skill.name, content), 'utf-8');
    this.invalidate();
    return skill.localPath;
  }

  patchSkill(name: string, oldText: string, newText: string, workspaceRoot?: string): string {
    const skill = this.find(name, workspaceRoot);
    if (!skill) throw new Error(`Skill "${name}" not found.`);
    const cur = readFileSync(skill.localPath, 'utf-8');
    if (!cur.includes(oldText)) throw new Error(`old_text not found in ${skill.name}/SKILL.md`);
    writeFileSync(skill.localPath, cur.replace(oldText, newText), 'utf-8');
    this.invalidate();
    return skill.localPath;
  }

  writeSkillFile(name: string, filePath: string, content: string, workspaceRoot?: string): string {
    const skill = this.find(name, workspaceRoot);
    if (!skill) throw new Error(`Skill "${name}" not found.`);
    const target = this.safeJoin(skill.dir, filePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf-8');
    this.invalidate();
    return target;
  }

  deleteSkillFile(name: string, filePath: string, workspaceRoot?: string): void {
    const skill = this.find(name, workspaceRoot);
    if (!skill) throw new Error(`Skill "${name}" not found.`);
    const target = this.safeJoin(skill.dir, filePath);
    if (relative(skill.dir, target) === 'SKILL.md') throw new Error('Use action=delete to remove the whole skill.');
    rmSync(target, { force: true, recursive: true });
    this.invalidate();
  }

  removeSkill(name: string, workspaceRoot?: string): boolean {
    const skill = this.find(name, workspaceRoot);
    if (!skill) return false;
    rmSync(skill.dir, { recursive: true, force: true });
    const lock = this.readLockFile();
    if (lock.skills[skill.name]) {
      delete lock.skills[skill.name];
      this.writeLockFile(lock);
    }
    this.invalidate();
    return true;
  }

  // ─── Hub: install from GitHub ─────────────────────────────────────────────

  /**
   * Install a skill from GitHub.
   * Accepted forms:
   *   owner/repo                       → skills/<name>/SKILL.md (or <name>/SKILL.md)
   *   owner/repo/path/to/skill         → that folder
   *   https://github.com/owner/repo/tree/<ref>/path/to/skill
   *   https://raw.githubusercontent.com/.../SKILL.md
   */
  async addSkill(nameOrSpec: string, source?: string, skillPath?: string): Promise<{ name: string; path: string; files: string[] }> {
    const spec = this.parseSource(nameOrSpec, source, skillPath);
    const name = this.validateName(spec.name);
    const targetDir = join(this.getSkillsDir(), name);
    const written: string[] = [];

    // Try GitHub contents API for the folder (fetches references/ too), then raw fallback.
    const apiUrl = `https://api.github.com/repos/${spec.repo}/contents/${spec.path}?ref=${spec.ref}`;
    let installedViaApi = false;
    try {
      const listing = await fetchJson(apiUrl);
      if (Array.isArray(listing)) {
        await this.downloadTree(spec.repo, spec.ref, spec.path, targetDir, written);
        installedViaApi = written.some(f => f.endsWith('SKILL.md'));
      }
    } catch {
      /* fall through to raw */
    }

    if (!installedViaApi) {
      const rawUrl = `https://raw.githubusercontent.com/${spec.repo}/${spec.ref}/${spec.path}/SKILL.md`;
      const resp = await fetch(rawUrl);
      if (!resp.ok) throw new Error(`Failed to download skill from ${rawUrl} (HTTP ${resp.status})`);
      const content = await resp.text();
      mkdirSync(targetDir, { recursive: true });
      const f = join(targetDir, 'SKILL.md');
      writeFileSync(f, content, 'utf-8');
      written.push(f);
    }

    const lock = this.readLockFile();
    lock.skills[name] = { name, source: spec.repo, sourceType: 'github', skillPath: spec.path };
    this.writeLockFile(lock);
    this.invalidate();
    return { name, path: targetDir, files: written.map(f => relative(targetDir, f)) };
  }

  private async downloadTree(repo: string, ref: string, path: string, targetDir: string, written: string[], depth = 0): Promise<void> {
    if (depth > 4) return;
    const listing = await fetchJson(`https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`);
    if (!Array.isArray(listing)) return;
    mkdirSync(targetDir, { recursive: true });
    for (const item of listing) {
      if (item.type === 'dir') {
        await this.downloadTree(repo, ref, `${path}/${item.name}`, join(targetDir, item.name), written, depth + 1);
      } else if (item.type === 'file' && item.download_url && item.size < 2_000_000) {
        const r = await fetch(item.download_url);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const out = join(targetDir, item.name);
        writeFileSync(out, buf);
        written.push(out);
      }
    }
  }

  private parseSource(nameOrSpec: string, source?: string, skillPath?: string): { name: string; repo: string; ref: string; path: string } {
    let s = (source ?? nameOrSpec).trim();
    let name = source ? nameOrSpec.trim() : '';
    let ref = 'main';

    // Full GitHub URL
    let m = s.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)\/(.+?))?\/?$/);
    if (m) {
      const repo = m[1];
      ref = m[2] ?? 'main';
      let p = (m[3] ?? '').replace(/\/SKILL\.md$/i, '');
      if (!p) p = `skills/${name || skillPath || ''}`.replace(/\/$/, '');
      name = name || p.split('/').filter(Boolean).pop() || repo.split('/')[1];
      return { name, repo, ref, path: p };
    }
    // Raw URL
    m = s.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+?)\/SKILL\.md$/i);
    if (m) {
      const p = m[3];
      return { name: name || p.split('/').pop()!, repo: m[1], ref: m[2], path: p };
    }
    // owner/repo[/path]
    m = s.match(/^([^/\s]+\/[^/\s]+)(?:\/(.+))?$/);
    if (m) {
      const repo = m[1];
      let p = m[2] ?? skillPath ?? '';
      p = p.replace(/\/SKILL\.md$/i, '').replace(/\/$/, '');
      if (!p) {
        if (!name) throw new Error('Skill name required: /skills install <name> <owner/repo>');
        p = `skills/${name}`;
      }
      name = name || p.split('/').filter(Boolean).pop()!;
      return { name, repo, ref, path: p };
    }
    throw new Error(`Unrecognised skill source: ${s}`);
  }

  /** Search known hubs (GitHub) for skills matching a query. */
  async search(query: string, limit = 15): Promise<SkillSearchResult[]> {
    const q = query.trim();
    const results: SkillSearchResult[] = [];
    // GitHub code search requires auth; use repo tree listing of known hubs instead.
    for (const hub of HUB_REPOS) {
      try {
        const tree = await fetchJson(`https://api.github.com/repos/${hub.repo}/git/trees/main?recursive=1`);
        const items: Array<{ path: string; type: string }> = tree?.tree ?? [];
        for (const it of items) {
          if (it.type !== 'blob' || !it.path.endsWith('/SKILL.md')) continue;
          if (!it.path.startsWith(hub.dir + '/')) continue;
          const folder = it.path.slice(0, -'/SKILL.md'.length);
          const name = folder.split('/').pop()!;
          if (q && !folder.toLowerCase().includes(q.toLowerCase())) continue;
          results.push({
            name,
            description: folder.replace(hub.dir + '/', ''),
            source: hub.repo,
            path: folder,
            installUrl: `https://github.com/${hub.repo}/tree/main/${folder}`,
          });
          if (results.length >= limit) return results;
        }
      } catch {
        /* hub unreachable */
      }
    }
    return results;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  validateName(name: string): string {
    const n = name.trim().replace(/^\//, '');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n)) {
      throw new Error(`Invalid skill name "${name}". Use letters, digits, dots, dashes, underscores.`);
    }
    return n;
  }

  private ensureFrontmatter(name: string, content: string): string {
    if (/^---\r?\n/.test(content)) return content.endsWith('\n') ? content : content + '\n';
    const desc = content.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? `${name} skill`;
    return `---\nname: ${name}\ndescription: ${desc.slice(0, 120)}\nversion: 1.0.0\n---\n\n${content.trim()}\n`;
  }

  private safeJoin(base: string, rel: string): string {
    const target = resolve(base, rel);
    const r = relative(base, target);
    if (isAbsolute(r) || r.startsWith('..')) throw new Error('Path escapes the skill directory.');
    return target;
  }

  /** Re-read files list for a skill (after writes). */
  refreshFiles(skill: InstalledSkill): void {
    skill.files = listSkillFiles(skill.dir);
  }

  toDefinition(skill: InstalledSkill): SkillDefinition {
    return skill.definition;
  }
}

async function fetchJson(url: string): Promise<any> {
  const headers: Record<string, string> = { 'User-Agent': 'mycode-cli', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export const skillManager = new SkillManager();
