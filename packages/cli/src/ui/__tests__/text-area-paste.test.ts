/**
 * Paste handling.
 *
 * Reported: "if something I paste it pastes 2 times and becomes messy."
 *
 * The composer has two listeners on stdin. Its own `data` handler is *prepended*
 * so it runs first and consumes a bracketed paste
 * (`ESC[200~ … ESC[201~`). But readline's own `data` listener still runs
 * afterwards on the same chunk and emits a `keypress` event for every character
 * in it. The composer guards its keypress handler with `pasteMode`, which is
 * cleared synchronously at the end of the data handler — so by the time readline
 * emits those keypresses the guard is already false and the text is inserted
 * twice.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import readline from 'readline';
import { TextArea } from '../text-area.js';
import { resetCapabilityCache } from '../capabilities.js';

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(v: boolean) {
    this.isRaw = v;
    return this;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
  setEncoding() {
    return this;
  }
}

class FakeStdout {
  isTTY = true;
  columns = 100;
  rows = 30;
  chunks: string[] = [];
  write(s: string) {
    this.chunks.push(String(s));
    return true;
  }
}

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** What the terminal sends for a bracketed paste. */
const bracketed = (text: string) => Buffer.from(`\x1b[200~${text}\x1b[201~`, 'utf-8');

/** What a terminal sends when bracketed paste is not in use. */
const raw = (text: string) => Buffer.from(text, 'utf-8');

describe('paste', () => {
  let stdin: FakeStdin;
  let stdout: FakeStdout;
  let origStdin: NodeJS.ReadStream;
  let origStdout: NodeJS.WriteStream;
  let area: TextArea;
  let pending: Promise<{ kind: string; text?: string }> | null = null;
  const realTerm = process.env.TERM;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdout = process.stdout;
    stdin = new FakeStdin();
    stdout = new FakeStdout();
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: stdout, configurable: true });
    process.env.TERM = 'xterm-256color';
    resetCapabilityCache();

    area = new TextArea({ prompt: '❯ ' });
  });

  afterEach(() => {
    area.close();
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
    if (realTerm === undefined) delete process.env.TERM;
    else process.env.TERM = realTerm;
    resetCapabilityCache();
  });

  /** The draft text the composer would submit, read from what it renders. */
  /** Start a read and leave it pending; the promise is kept for submission tests. */
  const startRead = async (): Promise<void> => {
    pending = area.read();
    pending.catch(() => {}); // closed-before-submit is fine in teardown
    await settle(2);
  };

  const draft = () => {
    const rendered = stdout.chunks.join('').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    const lines = rendered.split(/[\r\n]+/);
    // The last rendered frame contains the draft. A multi-line draft renders as
    // the prompt line followed by continuation lines prefixed with '│ '.
    const start = lines
      .map((l, i) => (l.startsWith('❯ ') ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    if (start === undefined) return '';
    const out = [lines[start].slice(2)];
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].startsWith('│ ')) break;
      out.push(lines[i].slice(2));
    }
    return out.join('\n');
  };

  it('inserts a bracketed paste exactly once', async () => {
    await startRead();
    stdin.emit('data', bracketed('hello world'));
    await settle();
    expect(draft()).toBe('hello world');
  });

  it('does not duplicate a multi-line bracketed paste', async () => {
    await startRead();
    const text = 'first line\nsecond line\nthird line';
    stdin.emit('data', bracketed(text));
    await settle();
    expect(draft()).not.toContain('first linefirst line');
    expect(draft()).toBe(text);
  });

  it('handles a paste split across several chunks', async () => {
    await startRead();
    stdin.emit('data', Buffer.from('\x1b[200~part one ', 'utf-8'));
    await settle();
    stdin.emit('data', Buffer.from('part two\x1b[201~', 'utf-8'));
    await settle();
    expect(draft()).toBe('part one part two');
  });

  it('still inserts normally typed characters once', async () => {
    await startRead();
    for (const ch of 'abc') stdin.emit('data', raw(ch));
    await settle();
    expect(draft()).toBe('abc');
  });

  it('does not leave paste markers in the draft', async () => {
    await startRead();
    stdin.emit('data', bracketed('piped'));
    await settle();
    expect(draft()).not.toContain('200~');
    expect(draft()).not.toContain('201~');
  });

  it('collapses a large paste but submits the full text', async () => {
    await startRead();
    const big = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    stdin.emit('data', bracketed(big));
    await settle();
    // Collapsed in the composer so the draft stays readable...
    expect(draft()).toMatch(/Pasted text #1/);
    // ...but the submitted prompt carries every line.
    stdin.emit('keypress', '\r', { name: 'return', sequence: '\r' });
    await expect(pending).resolves.toEqual({ kind: 'text', text: big });
  });
});

describe('paste without bracketed-paste support', () => {
  // Some terminals (legacy Windows consoles, some multiplexers) do not implement
  // bracketed paste, so a paste arrives as a burst of ordinary characters. It
  // must be inserted exactly once and must not trigger a repaint per character.
  let stdin: FakeStdin;
  let stdout: FakeStdout;
  let origStdin: NodeJS.ReadStream;
  let origStdout: NodeJS.WriteStream;
  let area: TextArea;
  const realTerm = process.env.TERM;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdout = process.stdout;
    stdin = new FakeStdin();
    stdout = new FakeStdout();
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: stdout, configurable: true });
    process.env.TERM = 'xterm-256color';
    resetCapabilityCache();
    area = new TextArea({ prompt: '❯ ' });
  });

  afterEach(() => {
    area.close();
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
    if (realTerm === undefined) delete process.env.TERM;
    else process.env.TERM = realTerm;
    resetCapabilityCache();
  });

  it('inserts a burst of characters exactly once', async () => {
    area.read().catch(() => {});
    await settle();
    stdin.emit('data', Buffer.from('pastedtext', 'utf-8'));
    await settle(4);
    const plain = stdout.chunks.join('').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    expect(plain).toContain('pastedtext');
    expect(plain).not.toContain('pastedtextpastedtext');
  });

  it('coalesces a burst into far fewer repaints than characters', async () => {
    area.read().catch(() => {});
    await settle(2);
    const before = stdout.chunks.filter((c) => c.includes('❯ ')).length;
    stdin.emit('data', Buffer.from('x'.repeat(200), 'utf-8'));
    await settle(4);
    const paints = stdout.chunks.filter((c) => c.includes('❯ ')).length - before;
    // One repaint for the whole burst, not one per character.
    expect(paints).toBeLessThanOrEqual(3);
  });
});
