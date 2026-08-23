/**
 * text-area.test — Interactive TextArea behavior, verified with a simulated TTY.
 *
 * process.stdin is faked as a TTY and real `readline.emitKeypressEvents` parses
 * raw byte sequences into keypress events, so these tests exercise the actual
 * input pipeline (typing, Shift+Enter, arrows, slash menu, Ctrl+C, history).
 * The fake stdout answers `\x1b[6n` cursor-position queries instantly so the
 * ANSI redraw loop runs fast without the 150ms fallback timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import readline from 'readline';
import { TextArea, type SlashMenuItem } from '../text-area.js';

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(v: boolean): this {
    this.isRaw = v;
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  setEncoding(): this {
    return this;
  }
}

class FakeStdout {
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    if (s.includes('\x1b[6n')) {
      // Answer cursor position reports synchronously-ish.
      setTimeout(() => (globalThis as any).__fakeStdin.emit('data', Buffer.from('\x1b[1;1R')), 0);
    }
    return true;
  }
}

const COMMANDS: SlashMenuItem[] = [
  { name: '/help', description: 'Show help' },
  { name: '/exit', description: 'Exit' },
  { name: '/model', description: 'Switch model', aliases: ['/m'] },
];

describe('TextArea (simulated TTY)', () => {
  let stdin: FakeStdin;
  let stdout: FakeStdout;
  let origStdin: NodeJS.ReadStream;
  let origStdout: NodeJS.WriteStream;
  let textarea: TextArea;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdout = process.stdout;
    stdin = new FakeStdin();
    stdout = new FakeStdout();
    (globalThis as any).__fakeStdin = stdin;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: stdout, configurable: true });

    textarea = new TextArea({
      prompt: '❯ ',
      commands: COMMANDS,
    });
  });

  afterEach(() => {
    textarea.close();
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
    vi.restoreAllMocks();
  });

  const type = (s: string) => {
    for (const ch of s) stdin.emit('data', Buffer.from(ch, 'utf-8'));
  };
  const press = (str: string, key: Partial<readline.Key>) =>
    stdin.emit('keypress', str, key);

  const tick = () => new Promise<void>((r) => setTimeout(r, 5));

  it('types printable characters and submits on Enter', async () => {
    const p = textarea.read();
    await tick();
    type('hi');
    await tick();
    press('\r', { name: 'return', sequence: '\r' });
    const submit = await p;
    expect(submit).toEqual({ kind: 'text', text: 'hi' });
    expect((textarea as any).history).toContain('hi');
  });

  it('inserts a newline with Shift+Enter', async () => {
    const p = textarea.read();
    await tick();
    type('a');
    press('\r', { name: 'return', shift: true, sequence: '\r' });
    type('b');
    press('\r', { name: 'return', sequence: '\r' });
    const submit = await p;
    expect(submit).toEqual({ kind: 'text', text: 'a\nb' });
  });

  it('filters the inline slash menu while typing and selects with Enter', async () => {
    const p = textarea.read();
    await tick();
    type('/he');
    await tick();
    const menu: SlashMenuItem[] = (textarea as any).menu;
    expect(menu.length).toBe(1);
    expect(menu[0].name).toBe('/help');
    press('\r', { name: 'return', sequence: '\r' });
    const submit = await p;
    expect(submit).toEqual({ kind: 'slash', name: '/help' });
  });

  it('matches slash command aliases in the menu', async () => {
    const p = textarea.read();
    await tick();
    type('/m');
    await tick();
    const menu: SlashMenuItem[] = (textarea as any).menu;
    expect(menu.length).toBe(1);
    expect(menu[0].name).toBe('/model');
    press('\r', { name: 'return', sequence: '\r' });
    expect(await p).toEqual({ kind: 'slash', name: '/model' });
  });

  it('clears input on Ctrl+C with text, then exits after confirmation', async () => {
    const p = textarea.read();
    await tick();
    type('hello');
    await tick();
    press('\x03', { name: 'c', ctrl: true, sequence: '\x03' });
    await tick();
    expect((textarea as any).text).toBe('');
    // read() is still pending (no submit yet)
    let resolved = false;
    p.then(() => (resolved = true));
    await tick();
    expect(resolved).toBe(false);
    // empty input: first press shows the "press again to exit" hint
    press('\x03', { name: 'c', ctrl: true, sequence: '\x03' });
    await tick();
    expect(resolved).toBe(false);
    // next press within the window exits
    press('\x03', { name: 'c', ctrl: true, sequence: '\x03' });
    expect(await p).toEqual({ kind: 'exit' });
  });

  it('recalls history with arrow-up', async () => {
    const p1 = textarea.read();
    await tick();
    type('first message');
    press('\r', { name: 'return', sequence: '\r' });
    await p1;

    void textarea.read();
    await tick();
    stdin.emit('data', Buffer.from('\x1b[A', 'utf-8')); // up arrow
    await tick();
    expect((textarea as any).text).toBe('first message');
    textarea.close();
  });

  it('moves the cursor with left/right arrow keys', async () => {
    void textarea.read();
    await tick();
    type('abc');
    await tick();
    stdin.emit('data', Buffer.from('\x1b[D', 'utf-8')); // left
    stdin.emit('data', Buffer.from('\x1b[D', 'utf-8')); // left
    await tick();
    expect((textarea as any).cursor).toBe(1);
    stdin.emit('data', Buffer.from('\x1b[C', 'utf-8')); // right
    await tick();
    expect((textarea as any).cursor).toBe(2);
    textarea.close();
  });

  it('deletes the word before the cursor with Ctrl+W', async () => {
    void textarea.read();
    await tick();
    type('hello world');
    await tick();
    // move to end, then ctrl+w should delete "world"
    press('\x17', { name: 'w', ctrl: true, sequence: '\x17' });
    await tick();
    expect((textarea as any).text).toBe('hello ');
    textarea.close();
  });
});
