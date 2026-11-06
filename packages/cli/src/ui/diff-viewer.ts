/**
 * Diff viewer — a scrollable, hunk-navigable full-screen view of changes.
 *
 * `/diff` previously printed the whole diff to scrollback, which is unusable
 * once a change spans more than a screen. This is a pager: per-file grouping,
 * hunk navigation, and keyboard control, built on the diff colouring the
 * renderer already had.
 */

import chalk from 'chalk';
import { theme, getWidth } from './themes/theme.js';
import { createInterface } from 'readline';

export interface DiffFile {
  path: string;
  /** Raw unified diff text for this file. */
  diff: string;
  additions: number;
  deletions: number;
}

export interface ParsedHunk {
  header: string;
  lines: string[];
  startLine: number;
}

export interface ParsedFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
}

/** Parse a unified diff into files and hunks. Tolerant of malformed input. */
export function parseUnifiedDiff(raw: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('--- ')) {
      // A new file begins. `--- ` also appears inside a file header, so only
      // start a new entry when we do not already have one open.
      if (line.startsWith('diff --git') || !current) {
        if (line.startsWith('diff --git')) {
          const m = line.match(/b\/(.+)$/);
          current = { path: m?.[1] ?? 'unknown', additions: 0, deletions: 0, hunks: [] };
          files.push(current);
          hunk = null;
        }
      }
      continue;
    }
    if (line.startsWith('+++ ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      if (line.startsWith('new file')) {
        // keep going
      }
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      hunk = { header: line, lines: [], startLine: m ? parseInt(m[1], 10) : 0 };
      if (!current) {
        current = { path: 'unknown', additions: 0, deletions: 0, hunks: [] };
        files.push(current);
      }
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk || !current) continue;

    hunk.lines.push(line);
    if (line.startsWith('+')) current.additions++;
    else if (line.startsWith('-')) current.deletions++;
  }

  return files;
}

export function renderDiffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return chalk.hex(theme.textDim)(line);
  if (line.startsWith('@@')) return chalk.hex(theme.diffHunk)(line);
  if (line.startsWith('+')) return chalk.hex(theme.diffAdd)(line);
  if (line.startsWith('-')) return chalk.hex(theme.diffDel)(line);
  return chalk.hex(theme.textMuted)(line);
}

/** Strip a leading +/-/space so the file name is comparable. */
function cleanPath(p: string): string {
  return p.replace(/^[ab]\//, '').trim();
}

export interface DiffViewerOptions {
  /** Render the diff to a string instead of opening the interactive pager. */
  static?: boolean;
  /** Max lines in static mode. */
  maxLines?: number;
}

/** Flatten the parsed diff into screen lines with file separators. */
export function buildDiffLines(files: ParsedFile[], width: number): string[] {
  const out: string[] = [];
  for (const file of files) {
    const bar = chalk.hex(theme.border)('─'.repeat(Math.max(20, width - 4)));
    out.push('');
    out.push(
      `  ${chalk.hex(theme.brand).bold(cleanPath(file.path))}  ` +
        chalk.hex(theme.diffAdd)(`+${file.additions}`) +
        ' ' +
        chalk.hex(theme.diffDel)(`-${file.deletions}`)
    );
    out.push(`  ${bar}`);
    for (const hunk of file.hunks) {
      out.push(`  ${chalk.hex(theme.diffHunk)(hunk.header.trim())}`);
      for (const line of hunk.lines) out.push(`  ${renderDiffLine(line)}`);
    }
  }
  out.push('');
  return out;
}

/** Non-interactive rendering — used by `/diff` and tests. */
export function renderDiff(raw: string, opts: DiffViewerOptions = {}): string {
  const files = parseUnifiedDiff(raw);
  if (!files.length) return chalk.hex(theme.textDim)('  No changes.');
  const lines = buildDiffLines(files, getWidth());
  const max = opts.maxLines ?? lines.length;
  if (lines.length > max) {
    const shown = lines.slice(0, max);
    shown.push(chalk.hex(theme.textDim)(`  … ${lines.length - max} more lines ( /diff --view for the pager )`));
    return shown.join('\n');
  }
  return lines.join('\n');
}

/**
 * Interactive pager. Keys:
 *   j / ↓, k / ↑   scroll a line        space / b   page
 *   n / p          next / previous file  g / G       top / bottom
 *   q / Esc        quit
 */
export async function openDiffViewer(raw: string): Promise<void> {
  const files = parseUnifiedDiff(raw);
  if (!files.length) {
    console.log(chalk.hex(theme.textDim)('  No changes.'));
    return;
  }

  const width = getWidth();
  const lines = buildDiffLines(files, width);
  const rows = Math.max(6, (process.stdout.rows || 24) - 2);

  // File boundary indices for n/p navigation.
  const fileStarts: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s{2}\S/.test(l) && !l.includes('─') && (lines[i + 1] ?? '').includes('─')) fileStarts.push(i);
  });

  let offset = 0;
  const maxOffset = Math.max(0, lines.length - rows);

  const draw = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    const header =
      chalk.hex(theme.brand).bold(`  Diff`) +
      chalk.hex(theme.textDim)(`  ${files.length} file${files.length === 1 ? '' : 's'}  `) +
      chalk.hex(theme.diffAdd)(`+${files.reduce((a, f) => a + f.additions, 0)}`) +
      ' ' +
      chalk.hex(theme.diffDel)(`-${files.reduce((a, f) => a + f.deletions, 0)}`);
    process.stdout.write(header + '\n');
    process.stdout.write(chalk.hex(theme.textDim)(`  j/k scroll  space/b page  n/p file  g/G ends  q quit`) + '\n');

    for (let i = offset; i < Math.min(lines.length, offset + rows); i++) {
      process.stdout.write(lines[i] + '\n');
    }
    const pct = maxOffset === 0 ? 100 : Math.round((offset / maxOffset) * 100);
    process.stdout.write(chalk.hex(theme.textDim)(`\n  ${pct}%  line ${offset + 1}/${lines.length}`));
  };

  return new Promise<void>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const rl = createInterface({ input: stdin });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlAny = rl as any;

    const cleanup = () => {
      rlAny.input?.removeListener?.('keypress', onKey);
      rl.close();
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
      process.stdout.write('\x1b[2J\x1b[H');
    };

    const onKey = (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      const name = key?.name ?? '';

      if (name === 'q' || name === 'escape' || (key?.ctrl && name === 'c')) {
        cleanup();
        resolve();
        return;
      }
      switch (name) {
        case 'j': case 'down': offset = Math.min(maxOffset, offset + 1); break;
        case 'k': case 'up': offset = Math.max(0, offset - 1); break;
        case 'space': case 'f': offset = Math.min(maxOffset, offset + rows); break;
        case 'b': offset = Math.max(0, offset - rows); break;
        case 'g': offset = 0; break;
        case 'G': offset = maxOffset; break;
        case 'n': {
          const next = fileStarts.find((i) => i > offset);
          offset = Math.min(maxOffset, next ?? maxOffset);
          break;
        }
        case 'p': {
          const prev = [...fileStarts].reverse().find((i) => i < offset);
          offset = Math.max(0, prev ?? 0);
          break;
        }
        default: return;
      }
      draw();
    };

    rlAny.input?.on?.('keypress', onKey);
    (rl as unknown as { _writeToOutput?: (s: string) => void })._writeToOutput = () => {};
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    draw();
  });
}

/** Compute per-file stats without needing the full diff parse. */
export function diffStats(raw: string): { files: number; additions: number; deletions: number } {
  const files = parseUnifiedDiff(raw);
  return {
    files: files.length,
    additions: files.reduce((a, f) => a + f.additions, 0),
    deletions: files.reduce((a, f) => a + f.deletions, 0),
  };
}
