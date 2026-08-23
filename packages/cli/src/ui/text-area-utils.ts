/**
 * text-area-utils — Pure helpers for the multiline text area.
 *
 * The text area renders text with terminal soft-wrapping, so we need to map
 * between character indices and visual (row, col) positions. All functions
 * here are pure and operating on plain text (no ANSI), which keeps them
 * trivially testable.
 */

export interface RowSpan {
  /** Index of the first character of this visual row in the source text. */
  start: number;
  /** Number of characters (not columns) in this visual row. */
  len: number;
}

const WORD_CHAR = /\p{L}|\p{N}|_/u;

/** Visual width of a single character (0 for control, 2 for wide/CJK/emoji). */
export function charWidth(ch: string): number {
  const c = ch.codePointAt(0);
  if (c === undefined || c < 32) return 0;
  if (
    c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) || (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd))
  ) {
    return 2;
  }
  return 1;
}

/** Visual width of a string. */
export function visLen(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

function isWordChar(ch: string): boolean {
  return WORD_CHAR.test(ch);
}

/**
 * Split text into visual rows (soft-wrapped at width W).
 * '\n' ends a logical line; a trailing '\n' produces a final empty row.
 * Returns spans into the original text; the '\n' characters themselves are
 * not part of any span (the cursor can never visually sit on them).
 */
export function buildRows(text: string, W: number): RowSpan[] {
  const rows: RowSpan[] = [];
  const parts = text.split('\n');
  let idx = 0;
  for (const part of parts) {
    if (part.length === 0) {
      rows.push({ start: idx, len: 0 });
      idx += 1;
      continue;
    }
    let start = 0;
    let curW = 0;
    for (let i = 0; i < part.length; i++) {
      const w = charWidth(part[i]);
      if (curW + w > W && curW > 0) {
        rows.push({ start: idx + start, len: i - start });
        start = i;
        curW = w;
      } else {
        curW += w;
      }
    }
    rows.push({ start: idx + start, len: part.length - start });
    idx += part.length + 1;
  }
  return rows;
}

/** Visual position of the cursor at `index` (index = chars before the cursor). */
export function posOfIndex(text: string, index: number, W: number): { row: number; col: number } {
  const rows = buildRows(text, W);
  if (rows.length === 0) return { row: 0, col: 0 };
  if (index >= text.length) {
    const last = rows[rows.length - 1];
    return { row: rows.length - 1, col: last.len };
  }
  for (let r = 0; r < rows.length; r++) {
    const { start, len } = rows[r];
    if (index >= start && index < start + len) return { row: r, col: index - start };
    if (index === start + len) return { row: r, col: len };
  }
  const last = rows[rows.length - 1];
  return { row: rows.length - 1, col: last.len };
}

/** Visual position of the end of text. */
export function endPos(text: string, W: number): { row: number; col: number } {
  return posOfIndex(text, text.length, W);
}

/**
 * Map a visual (row, col) back to a character index, clamped to the text.
 * This is the inverse of posOfIndex and is used for Up/Down navigation.
 */
export function indexAtVisual(text: string, row: number, col: number, W: number): number {
  const rows = buildRows(text, W);
  if (rows.length === 0) return 0;
  const r = Math.min(Math.max(row, 0), rows.length - 1);
  return rows[r].start + Math.min(Math.max(col, 0), rows[r].len);
}

/**
 * Same as buildRows but the first row is prefixed by a fixed visible-width
 * prompt (so it only has `W - promptWidth` columns available).
 */
export function buildInputRows(promptWidth: number, text: string, W: number): RowSpan[] {
  const rows: RowSpan[] = [];
  const parts = text.split('\n');
  let idx = 0;
  let avail = Math.max(1, W - promptWidth);
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (part.length === 0) {
      rows.push({ start: idx, len: 0 });
      idx += 1;
      avail = W;
      continue;
    }
    let start = 0;
    let curW = 0;
    for (let i = 0; i < part.length; i++) {
      const w = charWidth(part[i]);
      if (curW + w > avail && curW > 0) {
        rows.push({ start: idx + start, len: i - start });
        start = i;
        curW = w;
        avail = W;
      } else {
        curW += w;
      }
    }
    rows.push({ start: idx + start, len: part.length - start });
    idx += part.length + 1;
    avail = W;
  }
  return rows;
}

/** Position of an index within prompt-prefixed input rows. */
export function posOfIndexInput(
  rows: RowSpan[],
  index: number,
  text: string
): { row: number; col: number } {
  if (rows.length === 0) return { row: 0, col: 0 };
  if (index >= text.length) {
    return { row: rows.length - 1, col: rows[rows.length - 1].len };
  }
  for (let r = 0; r < rows.length; r++) {
    const { start, len } = rows[r];
    if (index >= start && index < start + len) return { row: r, col: index - start };
    if (index === start + len) return { row: r, col: len };
  }
  return { row: rows.length - 1, col: rows[rows.length - 1].len };
}

/** Map a visual position to an index within prompt-prefixed input rows. */
export function indexAtVisualInput(
  rows: RowSpan[],
  row: number,
  col: number
): number {
  if (rows.length === 0) return 0;
  const r = Math.min(Math.max(row, 0), rows.length - 1);
  return rows[r].start + Math.min(Math.max(col, 0), rows[r].len);
}

/**
 * Index of the start of the word before `index` (Ctrl+Left).
 * If the cursor is inside a word, jumps to that word's start; otherwise jumps
 * to the start of the previous word.
 */
export function wordStartBefore(text: string, index: number): number {
  let i = index;
  if (i > 0 && isWordChar(text[i - 1])) {
    while (i > 0 && isWordChar(text[i - 1])) i--;
  } else {
    while (i > 0 && !isWordChar(text[i - 1])) i--;
    while (i > 0 && isWordChar(text[i - 1])) i--;
  }
  return i;
}

/**
 * Index just past the end of the next word (Ctrl+Right, readline-style):
 * skip any punctuation/whitespace, then skip the word itself.
 */
export function wordEndAfter(text: string, index: number): number {
  const len = text.length;
  let i = index;
  while (i < len && !isWordChar(text[i])) i++;
  while (i < len && isWordChar(text[i])) i++;
  return i;
}

/** Index of the start of the logical line containing `index` (Home). */
export function lineStart(text: string, index: number): number {
  const nl = text.lastIndexOf('\n', index - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** Index just past the end of the logical line containing `index` (End). */
export function lineEnd(text: string, index: number): number {
  const nl = text.indexOf('\n', index);
  return nl === -1 ? text.length : nl;
}
