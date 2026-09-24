import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextArea } from '../text-area.js';

/**
 * Bracketed-paste handling in the presence of stray terminal reports.
 *
 * Terminals emit focus events (ESC[I / ESC[O) and cursor/attribute reports at
 * arbitrary times. On Windows ConPTY they routinely arrive in the same stdin
 * chunk as the start of a paste. The stray-report filter used to run first,
 * match, re-emit the chunk and return — so pasteMode never engaged and the
 * pasted text reached readline as ordinary keystrokes. Each of those
 * keystrokes triggered a render, which is what made the status line appear to
 * be printed once per character.
 */

function makeArea(text = ''): any {
  const ta: any = new TextArea({ prompt: '❯ ', placeholder: 'type…' });
  ta.busy = false;
  ta.closed = false;
  ta.readPromise = {}; // render() is a no-op without this
  ta.width = () => 200;
  ta.text = text;
  ta.cursor = text.length;
  return ta;
}

const START = '\x1b[200~';
const END = '\x1b[201~';

describe('bracketed paste with stray terminal reports', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('engages paste mode when a focus event shares the chunk', () => {
    const ta = makeArea();
    ta.onData(Buffer.from(`\x1b[I${START}hello world`));
    expect(ta.pasteMode).toBe(true);
    expect(ta.pasteBuffer).toBe('hello world');
    // Nothing leaked into the input.
    expect(ta.text).toBe('');
  });

  it('assembles a paste split across chunks with a report in the middle', () => {
    const ta = makeArea();
    ta.onData(Buffer.from(`${START}line one\n`));
    expect(ta.pasteMode).toBe(true);

    // A cursor-position report lands mid-paste.
    ta.onData(Buffer.from('\x1b[12;34Rline two\n'));
    expect(ta.pasteMode).toBe(true);
    expect(ta.pasteBuffer).toBe('line one\nline two\n');
    expect(ta.text).toBe('');

    ta.onData(Buffer.from(`line three${END}`));
    expect(ta.pasteMode).toBe(false);
    // Small paste is inserted verbatim.
    expect(ta.text).toBe('line one\nline two\nline three');
  });

  it('collapses a large paste into a placeholder and keeps the body', () => {
    const ta = makeArea();
    const big = Array.from({ length: 40 }, (_, i) => `stack line ${i}`).join('\n');
    ta.onData(Buffer.from(START + big + END));

    expect(ta.pasteMode).toBe(false);
    expect(ta.text).toMatch(/^\[Pasted text #1: 40 lines, [\d,]+ chars\]$/);
    // The real content is retrievable for submission.
    expect(ta.expandPastes(ta.text)).toBe(big);
  });

  it('normalises CRLF from Windows pastes', () => {
    const ta = makeArea();
    ta.onData(Buffer.from(START + 'a\r\nb\r\n' + END));
    expect(ta.text).toBe('a\nb\n');
  });

  it('still swallows a stray report when not pasting', () => {
    const ta = makeArea();
    const reEmitted: string[] = [];
    const orig = process.stdin.emit.bind(process.stdin);
    vi.spyOn(process.stdin, 'emit').mockImplementation(((ev: string, ...a: unknown[]) => {
      if (ev === 'data') reEmitted.push(String((a[0] as Buffer).toString()));
      return true;
    }) as any);

    ta.onData(Buffer.from('\x1b[I\x1b[O'));
    (process.stdin.emit as any).mockRestore();

    expect(ta.pasteMode).toBe(false);
    expect(ta.text).toBe('');
    // Pure reports strip to nothing, so nothing is re-emitted as keystrokes.
    expect(reEmitted).toEqual([]);
    void orig;
  });

  it('re-emits real text that shared a chunk with a report', () => {
    const ta = makeArea();
    const reEmitted: string[] = [];
    vi.spyOn(process.stdin, 'emit').mockImplementation(((ev: string, ...a: unknown[]) => {
      if (ev === 'data') reEmitted.push(String((a[0] as Buffer).toString()));
      return true;
    }) as any);

    ta.onData(Buffer.from('\x1b[Iabc'));
    (process.stdin.emit as any).mockRestore();

    expect(reEmitted).toEqual(['abc']);
  });
});
