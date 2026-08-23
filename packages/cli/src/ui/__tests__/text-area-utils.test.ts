import { describe, it, expect } from 'vitest';
import {
  charWidth,
  visLen,
  buildRows,
  posOfIndex,
  endPos,
  indexAtVisual,
  buildInputRows,
  wordStartBefore,
  wordEndAfter,
  lineStart,
  lineEnd,
} from '../text-area-utils.js';

describe('charWidth / visLen', () => {
  it('counts ASCII as width 1', () => {
    expect(charWidth('a')).toBe(1);
    expect(visLen('hello')).toBe(5);
  });

  it('counts CJK and emoji as width 2', () => {
    expect(charWidth('你')).toBe(2);
    expect(charWidth('😀')).toBe(2);
    expect(visLen('a你b')).toBe(4);
  });

  it('counts control characters as width 0', () => {
    expect(charWidth('\n')).toBe(0);
  });
});

describe('buildRows (soft wrapping)', () => {
  it('handles a simple wrap', () => {
    expect(buildRows('abc', 2)).toEqual([
      { start: 0, len: 2 },
      { start: 2, len: 1 },
    ]);
  });

  it('keeps logical lines separate', () => {
    expect(buildRows('ab\ncd', 10)).toEqual([
      { start: 0, len: 2 },
      { start: 3, len: 2 },
    ]);
  });

  it('produces a final empty row for a trailing newline', () => {
    expect(buildRows('ab\n', 10)).toEqual([
      { start: 0, len: 2 },
      { start: 3, len: 0 },
    ]);
  });

  it('handles empty text', () => {
    expect(buildRows('', 10)).toEqual([{ start: 0, len: 0 }]);
  });
});

describe('posOfIndex / endPos / indexAtVisual', () => {
  it('round-trips through a wrapped position', () => {
    const text = 'abcdefghij';
    // rows at W=5: [abcde] [fghij]
    expect(posOfIndex(text, 7, 5)).toEqual({ row: 1, col: 2 });
    expect(indexAtVisual(text, 1, 2, 5)).toBe(7);
  });

  it('reports the cursor right before a newline at the end of its line', () => {
    const text = 'ab\ncd';
    expect(posOfIndex(text, 2, 10)).toEqual({ row: 0, col: 2 });
    expect(posOfIndex(text, 3, 10)).toEqual({ row: 1, col: 0 });
    expect(endPos(text, 10)).toEqual({ row: 1, col: 2 });
  });

  it('clamps out-of-range visual positions', () => {
    const text = 'abc';
    expect(indexAtVisual(text, 99, 99, 2)).toBe(3);
    expect(indexAtVisual(text, -1, -1, 2)).toBe(0);
  });

  it('maps a cursor on the second row after wrapping', () => {
    const text = 'hello world';
    expect(posOfIndex(text, 8, 5)).toEqual({ row: 1, col: 3 });
    expect(indexAtVisual(text, 1, 3, 5)).toBe(8);
  });
});

describe('buildInputRows (prompt prefix)', () => {
  it('reserves the prompt width on the first row only', () => {
    // prompt width 2, terminal width 5 → first row has 3 columns
    expect(buildInputRows(2, 'abc', 5)).toEqual([{ start: 0, len: 3 }]);
    expect(buildInputRows(2, 'abcdef', 5)).toEqual([
      { start: 0, len: 3 },
      { start: 3, len: 3 },
    ]);
  });
});

describe('word navigation', () => {
  it('finds the previous word start', () => {
    expect(wordStartBefore('foo bar', 7)).toBe(4);
    expect(wordStartBefore('foo bar', 4)).toBe(0);
    expect(wordStartBefore('foo bar', 0)).toBe(0);
    expect(wordStartBefore('foo.bar_baz qux', 15)).toBe(12);
    expect(wordStartBefore('foo bar baz', 8)).toBe(4);
  });

  it('finds the next word end', () => {
    expect(wordEndAfter('foo bar', 0)).toBe(3);
    expect(wordEndAfter('foo bar', 4)).toBe(7);
    expect(wordEndAfter('foo bar', 3)).toBe(7);
    expect(wordEndAfter('foo bar', 7)).toBe(7);
  });
});

describe('line navigation', () => {
  it('finds logical line boundaries', () => {
    const text = 'first line\nsecond line\nthird';
    expect(lineStart(text, 20)).toBe(11);
    expect(lineEnd(text, 20)).toBe(22);
    expect(lineStart(text, 5)).toBe(0);
    expect(lineEnd(text, 5)).toBe(10);
    expect(lineEnd(text, 22)).toBe(22);
  });
});
