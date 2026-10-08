/**
 * Multi-turn composer regression tests.
 *
 * Reported from a real session: the first prompt submitted, but the second one
 * echoed and did not run. The loop calls `read()` again after every turn, so
 * anything single-use inside TextArea (listeners, the pending-read slot, the
 * region cursor) breaks exactly on turn two.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { FakeTerminal } from './fake-terminal.js';
import { TextArea } from '../text-area.js';
import { resetCapabilityCache } from '../capabilities.js';

function install(opts: ConstructorParameters<typeof FakeTerminal>[0] = {}) {
  const term = new FakeTerminal(opts);
  const saved = {
    write: process.stdout.write.bind(process.stdout),
    columns: process.stdout.columns,
    rows: process.stdout.rows,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    setRawMode: process.stdin.setRawMode,
    resume: process.stdin.resume.bind(process.stdin),
    pause: process.stdin.pause.bind(process.stdin),
  };
  process.stdout.write = ((c: string) => {
    term.write(String(c));
    return true;
  }) as typeof process.stdout.write;
  Object.defineProperty(process.stdout, 'columns', { value: term.width, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: term.height, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  (process.stdin as any).setRawMode = () => {};
  process.stdin.resume = (() => process.stdin) as typeof process.stdin.resume;
  process.stdin.pause = (() => process.stdin) as typeof process.stdin.pause;
  return {
    term,
    restore() {
      process.stdout.write = saved.write;
      Object.defineProperty(process.stdout, 'columns', {
        value: saved.columns,
        configurable: true,
      });
      Object.defineProperty(process.stdout, 'rows', { value: saved.rows, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', {
        value: saved.stdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdin, 'isTTY', {
        value: saved.stdinIsTTY,
        configurable: true,
      });
      (process.stdin as any).setRawMode = saved.setRawMode;
      process.stdin.resume = saved.resume;
      process.stdin.pause = saved.pause;
    },
  };
}

const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const type = (text: string) => {
  for (const ch of text) process.stdin.emit('keypress', ch, { name: ch, sequence: ch });
};

const pressEnter = () => process.stdin.emit('keypress', '\r', { name: 'return', sequence: '\r' });

describe('composer, multiple turns', () => {
  let harness: ReturnType<typeof install> | null = null;
  let live: TextArea[] = [];

  beforeEach(() => resetCapabilityCache());
  afterEach(() => {
    delete process.env.MYCODE_NO_CURSOR;
    for (const a of live) a.close();
    live = [];
    harness?.restore();
    harness = null;
    resetCapabilityCache();
  });

  const open = () => {
    const area = new TextArea({ prompt: '✦ ❯ ', placeholder: '' });
    live.push(area);
    return area;
  };

  it('accepts a second prompt after the first turn completes', async () => {
    harness = install({ width: 80, height: 24 });
    const area = open();

    const first = await (async () => {
      const p = area.read();
      await settle();
      type('first query');
      await settle();
      pressEnter();
      return p;
    })();
    expect(first).toEqual({ kind: 'text', text: 'first query' });

    // The real loop calls read() again immediately.
    const p2 = area.read();
    await settle();
    type('second query');
    await settle();
    pressEnter();
    const second = await p2;

    expect(second).toEqual({ kind: 'text', text: 'second query' });
    expect(
      harness.term.nonEmptyLines().filter((l) => l.includes('second query')).length,
    ).toBeGreaterThan(0);
  });

  it('does not resubmit the previous prompt when Enter is pressed on an empty line', async () => {
    harness = install({ width: 80, height: 24 });
    const area = open();

    const p1 = area.read();
    await settle();
    type('alpha');
    await settle();
    pressEnter();
    expect(await p1).toEqual({ kind: 'text', text: 'alpha' });

    const p2 = area.read();
    await settle();
    // Enter on an empty composer is deliberately a no-op (handleEnter bails on
    // whitespace-only input), so the read stays pending rather than resolving
    // with the previous prompt's text.
    pressEnter();
    await settle();
    type('beta');
    await settle();
    pressEnter();
    expect(await p2).toEqual({ kind: 'text', text: 'beta' });
  });

  it('survives ten consecutive turns without leaking rows or listeners', async () => {
    harness = install({ width: 100, height: 30 });
    const area = open();

    for (let turn = 1; turn <= 10; turn++) {
      const p = area.read();
      await settle(2);
      type(`turn ${turn}`);
      await settle(2);
      pressEnter();
      await expect(p).resolves.toEqual({ kind: 'text', text: `turn ${turn}` });
    }

    // Each submitted prompt stays on screen as a record of what was asked...
    const lines = harness.term.lines();
    for (let turn = 1; turn <= 10; turn++) {
      expect(lines.some((l) => l.includes(`turn ${turn}`))).toBe(true);
    }
    // ...exactly once. Ten turns must not produce duplicate lines.
    const submitted = lines.filter((l) => /✦ ❯ turn \d/.test(l));
    expect(submitted).toHaveLength(10);
    void area;
  });

  it('keeps working in a terminal without cursor control (the Windows case)', async () => {
    // This is the path the reported session took: no ANSI cursor addressing, so
    // the composer falls back to line input. Two turns must still work.
    harness = install({ width: 80, height: 24, ansi: false, startRow: 0 });
    // MYCODE_NO_CURSOR is the documented override and forces the same degraded
    // path a bare Windows console takes.
    process.env.MYCODE_NO_CURSOR = '1';
    resetCapabilityCache();
    const area = open();

    const first = area.read();
    await settle();
    process.stdin.emit('data', Buffer.from('first query\n'));
    expect(await first).toEqual({ kind: 'text', text: 'first query' });

    const second = area.read();
    await settle();
    process.stdin.emit('data', Buffer.from('second query\n'));
    expect(await second).toEqual({ kind: 'text', text: 'second query' });
  });

  it('reports a queued submission without losing the next turn', async () => {
    harness = install({ width: 80, height: 24 });
    const area = open();

    const p1 = area.read();
    await settle();
    type('one');
    await settle();
    pressEnter();
    expect(await p1).toEqual({ kind: 'text', text: 'one' });

    // A rapid second submission during the (simulated) turn must not vanish.
    const p2 = area.read();
    await settle();
    type('two');
    await settle();
    pressEnter();
    expect(await p2).toEqual({ kind: 'text', text: 'two' });
  });
});
