/**
 * SkillLoader — Discovers skills on disk and parses SKILL.md frontmatter.
 *
 * Skill layout (agentskills.io compatible):
 *
 *   my-skill/
 *   ├── SKILL.md          # required — frontmatter + procedure
 *   ├── references/       # optional — extra docs loaded on demand
 *   ├── scripts/          # optional — helper scripts
 *   └── templates/        # optional — templates
 *
 * A skill directory may also be nested under a category folder
 * (e.g. skills/devops/docker/SKILL.md) — the category is inferred from the
 * parent folder unless the frontmatter sets one explicitly.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { platform } from 'os';
import type { InstalledSkill, SkillFrontmatter } from './types.js';

const MAX_DEPTH = 4;
const SKIP_DIRS = new Set(['node_modules', '.git', 'references', 'scripts', 'templates', 'assets']);

// ─── Frontmatter ─────────────────────────────────────────────────────────────

/**
 * Minimal YAML-ish frontmatter parser. Handles:
 *   key: value
 *   key: [a, b, c]
 *   key:
 *     - a
 *     - b
 *   nested:
 *     child: value       (flattened as nested.child)
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const raw: Record<string, unknown> = {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { raw };

  const lines = match[1].split(/\r?\n/);
  const stack: Array<{ indent: number; key: string }> = [];
  let listKey: string | null = null;

  const setPath = (key: string, value: unknown) => {
    raw[key] = value;
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)![1].length;

    // List item
    const li = line.match(/^\s*-\s*(.*)$/);
    if (li && listKey) {
      const arr = (raw[listKey] as unknown[]) ?? [];
      arr.push(parseScalar(li[1]));
      raw[listKey] = arr;
      continue;
    }

    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const prefix = stack.map(s => s.key).join('.');
    const fullKey = prefix ? `${prefix}.${kv[1]}` : kv[1];
    const rest = kv[2].trim();

    if (rest === '') {
      // Either nested object or list follows
      stack.push({ indent, key: kv[1] });
      listKey = fullKey;
      continue;
    }
    listKey = null;
    setPath(fullKey, parseScalar(rest));
  }

  const asList = (v: unknown): string[] | undefined => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string' && v.trim()) return v.split(',').map(s => s.trim()).filter(Boolean);
    return undefined;
  };

  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k];
    return undefined;
  };

  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: raw.version !== undefined ? String(raw.version) : undefined,
    platforms: asList(raw.platforms),
    tags: asList(pick('tags', 'metadata.mycode.tags', 'metadata.hermes.tags')),
    category: (pick('category', 'metadata.mycode.category', 'metadata.hermes.category') as string | undefined),
    argumentHint: (pick('argument-hint', 'argumentHint') as string | undefined),
    raw,
  };
}

function parseScalar(v: string): unknown {
  const s = v.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(x => stripQuotes(x.trim())).filter(Boolean);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return stripQuotes(s);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Strip the frontmatter block from SKILL.md content. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

// ─── Platform filter ─────────────────────────────────────────────────────────

export function currentPlatformName(): 'macos' | 'linux' | 'windows' | string {
  const p = platform();
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return p;
}

export function isPlatformCompatible(platforms?: string[]): boolean {
  if (!platforms || platforms.length === 0) return true;
  const me = currentPlatformName();
  return platforms.map(p => p.toLowerCase()).some(p => p === me || (p === 'darwin' && me === 'macos') || (p === 'win32' && me === 'windows'));
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export class SkillLoader {
  /**
   * Recursively discover skills under `dirPath`.
   * Every directory that contains a SKILL.md is a skill.
   */
  loadFromDirectory(dirPath: string, origin: InstalledSkill['origin'] = 'user'): InstalledSkill[] {
    if (!existsSync(dirPath)) return [];
    const results: InstalledSkill[] = [];
    this.walk(dirPath, dirPath, 0, origin, results);
    return results;
  }

  loadSkillDir(skillDir: string, origin: InstalledSkill['origin'] = 'user', rootDir?: string): InstalledSkill | null {
    const skillPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillPath)) return null;
    let content = '';
    try {
      content = readFileSync(skillPath, 'utf-8');
    } catch {
      return null;
    }
    const fm = parseFrontmatter(content);
    const name = (fm.name || basename(skillDir)).trim();

    // Category from frontmatter or the parent folder when nested under the root.
    let category = fm.category;
    if (!category && rootDir) {
      const rel = relative(rootDir, skillDir);
      const parts = rel.split(/[\\/]/).filter(Boolean);
      if (parts.length > 1) category = parts.slice(0, -1).join('/');
    }

    const description = fm.description || firstParagraph(stripFrontmatter(content)) || '';

    return {
      name,
      definition: {
        name,
        source: skillDir,
        sourceType: origin === 'workspace' ? 'workspace' : origin === 'bundled' ? 'bundled' : 'local',
        skillPath,
      },
      description,
      localPath: skillPath,
      dir: skillDir,
      frontmatter: fm,
      category,
      tags: fm.tags ?? [],
      version: fm.version,
      platforms: fm.platforms,
      origin,
      files: listSkillFiles(skillDir),
    };
  }

  private walk(root: string, dir: string, depth: number, origin: InstalledSkill['origin'], out: InstalledSkill[]): void {
    if (depth > MAX_DEPTH) return;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasSkill = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkill && dir !== root) {
      const skill = this.loadSkillDir(dir, origin, root);
      if (skill) out.push(skill);
      return; // Don't descend into a skill's own subfolders
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      this.walk(root, join(dir, entry.name), depth + 1, origin, out);
    }
  }
}

function firstParagraph(md: string): string {
  const lines = md.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t.replace(/[*_`]/g, '').slice(0, 160);
  }
  return '';
}

/** List reference/script/template files relative to the skill dir (max 200). */
export function listSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length >= 200) return;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        const rel = relative(skillDir, full).split('\\').join('/');
        if (rel !== 'SKILL.md') out.push(rel);
      }
    }
  };
  walk(skillDir, 0);
  return out.sort();
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export { dirname as _dirname };
