/**
 * ToolOutputStore — bounded tool output with spill-to-disk.
 *
 * Replaces naive `content.slice(0, N)` truncation, which has two failure modes:
 *   1. It cuts mid-function, so the model reasons from a syntactically broken
 *      fragment.
 *   2. It says nothing about what was removed, so the model does not know it is
 *      missing information.
 *
 * Instead we keep a head/tail window, write the full output to
 * `~/.mycode/tool-output/<hash>.txt`, and append a machine-readable note telling
 * the model that truncation happened and exactly how to read the rest with the
 * existing `read_file` tool. Head+tail keeps the command line and the error
 * summary, which is what usually matters.
 */

import { createHash } from 'crypto';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';

export interface TruncateOptions {
  /** Total characters allowed in the model-visible result. */
  maxChars?: number;
  /** Characters kept from the start. */
  headChars?: number;
  /** Characters kept from the end. */
  tailChars?: number;
  /** Where to spill. Defaults to the tool-output store dir. */
  dir?: string;
  /** Skip disk spill entirely (useful for tests). */
  noSpill?: boolean;
  /** Label used in the truncation notice. */
  label?: string;
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalChars: number;
  keptChars: number;
  /** Path to the full output, when spilled. */
  spillPath?: string;
}

const DEFAULT_MAX_CHARS = 40_000;
const DEFAULT_HEAD = 24_000;
const DEFAULT_TAIL = 12_000;

export function toolOutputDir(): string {
  const base = process.env.MYCODE_HOME || join(homedir() || tmpdir(), '.mycode');
  return join(base, 'tool-output');
}

/**
 * Create `dir` if needed. Returns false rather than attempting a deep recursive
 * create when no recent ancestor exists — on pathological paths (unmounted
 * volumes, virtual filesystems) `mkdirSync(recursive)` can block indefinitely,
 * and a stall inside a tool call is far worse than losing the spill file.
 */
function ensureDir(dir: string): boolean {
  if (existsSync(dir)) return true;
  const parent = dirname(dir);
  if (!existsSync(parent)) {
    const grandparent = dirname(parent);
    if (!existsSync(grandparent)) return false;
  }
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bound a tool result for the context window. Never throws: a failure to spill
 * degrades to plain head/tail truncation.
 */
export function truncateToolOutput(raw: string, opts: TruncateOptions = {}): TruncateResult {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  // Head and tail must fit inside the visible budget. Without this clamp a small
  // maxChars combined with the (larger) default head/tail produces a negative
  // "omitted" count and returns *more* characters than it removed.
  const headChars = Math.min(opts.headChars ?? DEFAULT_HEAD, Math.floor(maxChars * 0.6));
  const tailChars = Math.min(opts.tailChars ?? DEFAULT_TAIL, Math.floor(maxChars * 0.4));
  const label = opts.label ?? 'output';

  if (raw.length <= maxChars) {
    return { text: raw, truncated: false, originalChars: raw.length, keptChars: raw.length };
  }

  const head = raw.slice(0, headChars);
  const tail = raw.slice(raw.length - tailChars);
  const removed = raw.length - headChars - tailChars;

  let spillPath: string | undefined;
  if (!opts.noSpill) {
    try {
      const dir = opts.dir ?? toolOutputDir();
      const ready = ensureDir(dir);
      if (!ready) throw new Error(`cannot create spill directory: ${dir}`);
      const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);
      const file = join(dir, `${label.replace(/[^A-Za-z0-9_-]/g, '_')}-${hash}.txt`);
      if (!existsSync(file)) writeFileSync(file, raw, 'utf-8');
      spillPath = file;
    } catch {
      spillPath = undefined;
    }
  }

  const notice = spillPath
    ? `\n\n... [${removed} characters omitted from the middle of this ${label}] ...\n` +
      `Full output saved to: ${spillPath}\n` +
      `Use read_file with offset/limit on that path to inspect the omitted region.\n\n`
    : `\n\n... [${removed} characters omitted from the middle of this ${label}] ...\n` +
      `Re-run the command with a narrower filter if you need the omitted region.\n\n`;

  return {
    text: head + notice + tail,
    truncated: true,
    originalChars: raw.length,
    keptChars: head.length + notice.length + tail.length,
    spillPath,
  };
}

/** Remove spill files older than `maxAgeMs`. Best-effort. */
export function pruneToolOutputs(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  const dir = toolOutputDir();
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  try {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try {
        if (statSync(file).mtimeMs < cutoff) {
          unlinkSync(file);
          removed++;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return removed;
}

/** Read back a spilled output. Used by tests and the /context command. */
export function readSpilledOutput(path: string, limit = 200_000): string {
  return readFileSync(path, 'utf-8').slice(0, limit);
}
