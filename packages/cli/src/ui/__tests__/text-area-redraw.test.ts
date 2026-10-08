import { describe, it, expect, afterEach } from 'vitest';
import { FakeTerminal } from './fake-terminal.js';
import { TextArea } from '../text-area.js';
import { resetCapabilityCache } from '../capabilities.js';

const STATUS = ' ⚕ provider/model-name │ 0/128.0k │ ██████████ 0% │ 2s';

/** Install a fake terminal in front of process.stdout. */
function installTerminal(opts: { width?: number; height?: number; ansi?: boolean; startRow?: number } = {}) {
  const term = new FakeTerminal(opts);
  const original = {
    write: process.stdout.write.bind(process.stdout),
    columns: process.stdout.columns,
    rows: process.stdout.rows,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    setRawMode: (process.stdin as unknown as { setRawMode?: unknown }).setRawMode,
    resume: process.stdin.resume.bind(process.stdin),
    pause: process.stdin.pause.bind(process.stdin),
  };

  (process.stdout as unknown as { write: unknown }).write = (chunk: string) => {
    term.write(String(chunk));
    return true;
  };
  Object.defineProperty(process.stdout, 'columns', { value: term.width, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: term.height, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  (process.stdin as unknown as { setRawMode: unknown }).setRawMode = () => {};
  (process.stdin as unknown as { resume: unknown }).resume = () => {};
  (process.stdin as unknown as { pause: unknown }).pause = () => {};

  return {
    term,
    restore() {
      (process.stdout as unknown as { write: unknown }).write = original.write;
      Object.defineProperty(process.stdout, 'columns', { value: original.columns, configurable: true });
      Object.defineProperty(process.stdout, 'rows', { value: original.rows, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: original.stdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: original.stdinIsTTY, configurable: true });
      (process.stdin as unknown as { setRawMode: unknown }).setRawMode = original.setRawMode;
      (process.stdin as unknown as { resume: unknown }).resume = original.resume;
      (process.stdin as unknown as { pause: unknown }).pause = original.pause;
    },
  };
}

/** Let the render promise chain drain. */
async function settle(area: TextArea, times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await (area as unknown as { renderChain: Promise<void> }).renderChain;
    await new Promise((r) => setTimeout(r, 0));
  }
}

function type(area: TextArea, str: string): void {
  for (const ch of str) {
    process.stdin.emit('keypress', ch, { name: ch, sequence: ch, ctrl: false, meta: false, shift: false });
  }
}

describe('composer redraw', () => {
  let harness: ReturnType<typeof installTerminal> | null = null;
  let live: TextArea[] = [];

  const open = (opts: { prompt: string; placeholder?: string; statusLine?: () => string | null }) => {
    const area = new TextArea(opts);
    live.push(area);
    return area;
  };

  afterEach(() => {
    // A TextArea attaches keypress listeners to process.stdin. Leaking one
    // means the next test's terminal receives two renderers' output.
    for (const a of live) a.close();
    live = [];
    harness?.restore();
    harness = null;
  });

  it('replaces the status line on each keystroke instead of appending one', async () => {
    // The symptom this guards against: typing 8 characters leaves 8 status
    // lines on screen, because each redraw failed to erase the previous region.
    resetCapabilityCache();
    harness = installTerminal({ width: 80, height: 30 });
    const area = open({ prompt: '✦ ❯ ', placeholder: '', statusLine: () => STATUS });
    const read = area.read();

    await settle(area);
    expect(harness.term.countRowsContaining('⚕'), 'after first paint').toBe(1);

    type(area, 'what all');
    await settle(area);

    expect(harness.term.countRowsContaining('⚕'), 'after typing 8 characters').toBe(1);
    expect(harness.term.countRowsContaining('✦ ❯'), 'prompt rows').toBe(1);
    expect(harness.term.text()).toContain('what all');

    void read;
  });

  it('DOES duplicate when the console ignores ANSI cursor control', async () => {
    // Establishes the diagnosis for the reported bug: with VT processing off
    // (the default in some Windows hosts), the erase/redraw sequences are inert,
    // so every keystroke appends another copy of the status line. This is the
    // exact symptom — 8 characters typed produced 8 status lines.
    harness = installTerminal({ width: 80, height: 40, ansi: false });
    const area = open({ prompt: '✦ ❯ ', placeholder: '', statusLine: () => STATUS });
    const read = area.read();
    await settle(area);

    type(area, 'what all');
    await settle(area);

    expect(harness.term.countRowsContaining('⚕')).toBeGreaterThan(1);

    void read;
  });

  it('keeps the input on one row when the status line fills the width', async () => {
    // A status line that wraps silently desyncs the row arithmetic: the code
    // believes the region is one row shorter than it really is.
    harness = installTerminal({ width: 80, height: 30 });
    const long = ' ⚕ ' + 'x'.repeat(120);
    const area = open({ prompt: '✦ ❯ ', placeholder: '', statusLine: () => long });
    const read = area.read();
    await settle(area);

    type(area, 'abc');
    await settle(area);

    expect(harness.term.overflowingRows()).toEqual([]);
    expect(harness.term.countRowsContaining('✦ ❯'), 'prompt rows').toBe(1);
    expect(harness.term.text()).toContain('abc');

    void read;
  });

  it('survives the region sitting at the bottom of the screen', async () => {
    // Near the bottom, writing a newline scrolls the screen; a redraw that
    // assumes the screen did not move lands in the wrong place.
    harness = installTerminal({ width: 80, height: 12, startRow: 10 });
    const area = open({ prompt: '✦ ❯ ', placeholder: '', statusLine: () => STATUS });
    const read = area.read();
    await settle(area);

    type(area, 'hello');
    await settle(area);

    expect(harness.term.countRowsContaining('⚕'), 'status rows after scrolling').toBe(1);
    expect(harness.term.countRowsContaining('✦ ❯'), 'prompt rows').toBe(1);

    void read;
  });
});
