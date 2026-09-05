/**
 * patch — Targeted search-and-replace edit.
 *
 * Matching strategy (first that yields exactly one match wins):
 *   1. exact
 *   2. line-trimmed (ignores leading/trailing whitespace per line)
 *   3. whitespace-normalised (all runs of whitespace collapsed)
 * Multiple matches → error asking for more context (unless replaceAll).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { ToolModule } from '../types.js';

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

interface MatchResult {
  start: number;
  end: number;
  strategy: 'exact' | 'trimmed' | 'whitespace';
}

function findAll(content: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = content.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = content.indexOf(needle, i + needle.length);
  }
  return out;
}

/** Locate `oldStr` in `content` with progressively fuzzier strategies. */
export function locate(content: string, oldStr: string): { matches: MatchResult[]; strategy: MatchResult['strategy'] } {
  // 1. exact
  const exact = findAll(content, oldStr).map(s => ({ start: s, end: s + oldStr.length, strategy: 'exact' as const }));
  if (exact.length) return { matches: exact, strategy: 'exact' };

  // 2. per-line trimmed matching
  const needleLines = oldStr.split('\n').map(l => l.trim());
  while (needleLines.length && needleLines[needleLines.length - 1] === '') needleLines.pop();
  while (needleLines.length && needleLines[0] === '') needleLines.shift();
  if (needleLines.length) {
    const lines = content.split('\n');
    const offsets: number[] = [];
    let acc = 0;
    for (const l of lines) {
      offsets.push(acc);
      acc += l.length + 1;
    }
    const trimmed: MatchResult[] = [];
    for (let i = 0; i + needleLines.length <= lines.length; i++) {
      let ok = true;
      for (let j = 0; j < needleLines.length; j++) {
        if (lines[i + j].trim() !== needleLines[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const start = offsets[i];
        const lastIdx = i + needleLines.length - 1;
        const end = offsets[lastIdx] + lines[lastIdx].length;
        trimmed.push({ start, end, strategy: 'trimmed' });
      }
    }
    if (trimmed.length) return { matches: trimmed, strategy: 'trimmed' };
  }

  // 3. whitespace-collapsed matching
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const needleC = collapse(oldStr);
  if (needleC.length >= 8) {
    // Build a map from collapsed index → original index
    const map: number[] = [];
    let collapsed = '';
    let prevSpace = true;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (/\s/.test(ch)) {
        if (!prevSpace) {
          collapsed += ' ';
          map.push(i);
        }
        prevSpace = true;
      } else {
        collapsed += ch;
        map.push(i);
        prevSpace = false;
      }
    }
    const ws: MatchResult[] = findAll(collapsed, needleC).map(s => ({
      start: map[s],
      end: map[s + needleC.length - 1] + 1,
      strategy: 'whitespace' as const,
    }));
    if (ws.length) return { matches: ws, strategy: 'whitespace' };
  }

  return { matches: [], strategy: 'exact' };
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

export const editFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'patch',
      description:
        'Edit an existing file by replacing an exact block of text (old_string) with new_string. Include 3+ lines of surrounding context so the match is unique. Matching tolerates indentation/whitespace differences. Prefer this over write_file for modifying existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          old_string: { type: 'string', description: 'Exact text to find (must be unique unless replace_all=true). Empty string with create_if_missing=true creates a new file.' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
          create_if_missing: { type: 'boolean', description: 'Create the file if it does not exist (default false)' },
          dry_run: { type: 'boolean', description: 'Return the diff without writing (default false)' },
          // legacy camelCase aliases kept for older prompts
          oldString: { type: 'string', description: 'Alias of old_string' },
          newString: { type: 'string', description: 'Alias of new_string' },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd, options) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const oldString = String(args.old_string ?? args.oldString ?? '');
    const newString = String(args.new_string ?? args.newString ?? '');
    const createIfMissing = args.create_if_missing === true || args.createIfMissing === true;
    const replaceAll = args.replace_all === true || args.replaceAll === true;
    const dryRun = args.dry_run === true || args.dryRun === true;

    if (!filePath) throw new Error('Path is required');
    if (args.old_string === undefined && args.oldString === undefined && !createIfMissing) {
      throw new Error('old_string is required');
    }

    const resolvedPath = resolve(cwd, filePath);
    let content: string;
    let isNew = false;
    if (existsSync(resolvedPath)) {
      content = normalizeLineEndings(await readFile(resolvedPath, 'utf-8'));
    } else if (createIfMissing) {
      content = '';
      isNew = true;
    } else {
      throw new Error(`File not found: ${filePath}. Use write_file to create new files or set create_if_missing=true.`);
    }

    const normalizedOld = normalizeLineEndings(oldString);
    const normalizedNew = normalizeLineEndings(newString);
    if (normalizedOld === normalizedNew && !isNew) {
      throw new Error('old_string and new_string are identical — nothing to change.');
    }

    let newContent: string;
    let replaced = 0;
    let strategy: MatchResult['strategy'] = 'exact';

    if (isNew && !normalizedOld) {
      newContent = normalizedNew;
      replaced = 1;
    } else {
      const { matches, strategy: st } = locate(content, normalizedOld);
      strategy = st;
      if (matches.length === 0) {
        const hint = normalizedOld.split('\n')[0]?.trim().slice(0, 60);
        const near = hint ? content.split('\n').findIndex(l => l.includes(hint.slice(0, 20))) : -1;
        throw new Error(
          `Could not find old_string in ${filePath}.${near >= 0 ? ` A similar line exists near line ${near + 1} — re-read the file and copy the exact text.` : ' Re-read the file and copy the exact text (including indentation).'}`
        );
      }
      if (matches.length > 1 && !replaceAll) {
        const lines = matches.slice(0, 6).map(m => lineOf(content, m.start)).join(', ');
        throw new Error(`old_string matches ${matches.length} locations (lines ${lines}). Add more surrounding context to make it unique, or set replace_all=true.`);
      }
      const targets = replaceAll ? matches : [matches[0]];
      let out = '';
      let cursor = 0;
      for (const m of targets) {
        out += content.slice(cursor, m.start) + normalizedNew;
        cursor = m.end;
      }
      out += content.slice(cursor);
      newContent = out;
      replaced = targets.length;
    }

    const patch = createTwoFilesPatch(filePath, filePath, content, newContent, '', '', { context: 2 });
    const added = (patch.match(/^\+(?!\+\+)/gm) || []).length;
    const removed = (patch.match(/^-(?!--)/gm) || []).length;
    const diffBody = patch.split('\n').slice(4).join('\n').trim();

    if (dryRun) {
      return `Dry run for ${filePath}: ${replaced} replacement(s), +${added} −${removed}\n\n${diffBody}`;
    }

    if (options?.confirmFn) {
      const ok = await options.confirmFn(filePath, `patch (+${added} −${removed})\n${diffBody.slice(0, 1500)}`);
      if (!ok) return 'Edit cancelled by user.';
    }

    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, newContent, 'utf-8');

    const firstLine = isNew ? 1 : lineOf(content, locate(content, normalizedOld).matches[0]?.start ?? 0);
    const note = strategy !== 'exact' ? ` (matched with ${strategy} whitespace tolerance)` : '';
    return `${isNew ? 'Created' : 'Edited'} ${filePath}${isNew ? '' : ` at line ${firstLine}`}: ${replaced} replacement(s), +${added} −${removed}${note}\n\n${diffBody.slice(0, 4000)}`;
  },
};
