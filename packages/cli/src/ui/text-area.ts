/**
 * text-area — A true multiline terminal text area (gemini-cli / openclaude style).
 *
 * Behavior:
 *   - Enter            → submit
 *   - Shift+Enter / Alt+Enter / Ctrl+Enter → insert newline
 *   - ↑/↓              → move cursor between wrapped lines; navigate history at the edges
 *   - ←/→              → move cursor by character (across line boundaries)
 *   - Ctrl+← / Ctrl+→  → move by word
 *   - Home / End, Ctrl+A / Ctrl+E → start / end of logical line
 *   - Ctrl+W           → delete word before cursor
 *   - Ctrl+U / Ctrl+K  → delete to start / end of logical line
 *   - Delete / Ctrl+D  → delete char at cursor
 *   - Ctrl+L           → clear screen
 *   - Esc              → close slash menu / clear input
 *   - Ctrl+C           → clear input, then exit on second press
 *   - /                → live-filtering slash command menu (openclaude style)
 *   - Paste            → inserted at the cursor (bracketed paste)
 *
 * Rendering is done with raw ANSI redraw: the region (slash menu + input) is
 * erased and redrawn on every change, using cursor-position reports so it
 * stays correct even when the terminal scrolls.
 */

import readline from 'readline';
import chalk from 'chalk';
import { theme, stripAnsi } from './themes/theme.js';
import {
  visLen,
  buildInputRows,
  posOfIndexInput,
  indexAtVisualInput,
  wordStartBefore,
  wordEndAfter,
  lineStart,
  lineEnd,
} from './text-area-utils.js';

export interface SlashMenuItem {
  name: string;
  description: string;
  aliases?: string[];
}

export type TextAreaSubmit =
  | { kind: 'text'; text: string }
  | { kind: 'slash'; name: string }
  | { kind: 'exit' };

/** Submits that get committed to the chat log (text messages and slash commands). */
type CommitSubmit = { kind: 'text'; text: string } | { kind: 'slash'; name: string };

export interface TextAreaOptions {
  /** ANSI-styled prompt string shown before the input text. */
  prompt: string;
  /** Dim placeholder shown when the input is empty. */
  placeholder?: string;
  /** Slash commands offered by the inline menu. */
  commands?: SlashMenuItem[];
  /** Input history (persists across reads). */
  history?: string[];
  /** Called when Ctrl+C is pressed while busy (processing). */
  onInterrupt?: () => void;
}

const MAX_MENU_ROWS = 12;
const MAX_HISTORY = 100;

export class TextArea {
  private opts: TextAreaOptions;
  private text = '';
  private cursor = 0;
  private history: string[];
  private historyIndex = -1;
  private pendingText: string | null = null;
  private menu: SlashMenuItem[] = [];
  private menuIndex = 0;

  private busy = false;
  private closed = false;
  private readPromise: { resolve: (v: TextAreaSubmit) => void } | null = null;
  private nonTTYHandlers: {
    onData: (c: Buffer) => void;
    onEnd: () => void;
  } | null = null;

  // Rendering state
  private regionTop: number | null = null;
  private prevCursorRow = 0;
  private pendingPos: {
    promise: Promise<{ row: number; col: number }>;
    resolve: (p: { row: number; col: number }) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private renderChain: Promise<void> = Promise.resolve();

  // Input state
  private lastCtrlC = 0;
  private pasteMode = false;
  private pasteBuffer = '';
  private rawEnabled = false;
  private keyHandler: (str: string, key: readline.Key) => void = () => {};
  private dataHandler: (chunk: Buffer) => void = () => {};

  constructor(opts: TextAreaOptions) {
    this.opts = opts;
    this.history = [...(opts.history ?? [])];
  }

  /** Mark the text area as busy (processing); Ctrl+C then triggers onInterrupt. */
  setBusy(b: boolean): void {
    this.busy = b;
  }

  /** Wait for the user to submit a message. Call again after processing. */
  async read(): Promise<TextAreaSubmit> {
    if (!process.stdin.isTTY) {
      return this.readLineNonTTY();
    }
    this.ensureInput();
    if (this.readPromise) {
      throw new Error('TextArea.read() already pending');
    }
    this.clearInput();
    const promise = new Promise<TextAreaSubmit>((resolve) => {
      this.readPromise = { resolve };
    });
    void this.render();
    return promise;
  }

  /** Restore the terminal and release input listeners. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.rawEnabled) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* not a TTY */
      }
      this.rawEnabled = false;
    }
    process.stdin.removeListener('keypress', this.keyHandler);
    process.stdin.removeListener('data', this.dataHandler);
    if (this.pendingPos) {
      clearTimeout(this.pendingPos.timer);
      this.pendingPos = null;
    }
    if (this.nonTTYHandlers) {
      process.stdin.removeListener('data', this.nonTTYHandlers.onData);
      process.stdin.removeListener('end', this.nonTTYHandlers.onEnd);
      this.nonTTYHandlers = null;
    }
    this.readPromise?.resolve({ kind: 'exit' });
    this.readPromise = null;
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  private ensureInput(): void {
    if (this.rawEnabled) return;
    readline.emitKeypressEvents(process.stdin);
    try {
      process.stdin.setRawMode(true);
      this.rawEnabled = true;
    } catch {
      this.rawEnabled = false;
    }
    process.stdin.resume();

    this.keyHandler = (str: string, key: readline.Key) => this.onKeypress(str, key);
    this.dataHandler = (chunk: Buffer) => this.onData(chunk);

    process.stdin.on('keypress', this.keyHandler);
    process.stdin.prependListener('data', this.dataHandler);
  }

  // ─── Raw data (paste + cursor position reports) ──────────────────────────

  private onData(chunk: Buffer): void {
    const s = chunk.toString('utf-8');

    if (this.pendingPos) {
      const m = s.match(/\x1b\[(\d+);(\d+)R/);
      if (m) {
        clearTimeout(this.pendingPos.timer);
        const { resolve } = this.pendingPos;
        this.pendingPos = null;
        resolve({ row: Number(m[1]), col: Number(m[2]) });
        const rest = s.replace(/\x1b\[\d+;\d+R/, '');
        if (rest) process.stdin.emit('data', Buffer.from(rest));
        return;
      }
    }

    // Shift+Enter / Alt+Enter as CSI-u sequences (Windows Terminal, kitty…)
    const newlineSeq = s.match(/\x1b\[13;\d+u/g);
    if (newlineSeq) {
      if (!this.busy && !this.closed) {
        for (let i = 0; i < newlineSeq.length; i++) this.insertAt('\n');
        void this.render();
      }
      const rest = newlineSeq.reduce((acc, seq) => acc.replace(seq, ''), s);
      if (rest) process.stdin.emit('data', Buffer.from(rest));
      return;
    }

    if (s.includes('\x1b[200~')) {
      this.pasteMode = true;
      this.pasteBuffer = '';
    }

    if (this.pasteMode) {
      const body = s.replace(/\x1b\[200~|\x1b\[201~/g, '');
      if (body) this.pasteBuffer += body;
      if (s.includes('\x1b[201~')) {
        this.pasteMode = false;
        if (!this.busy && !this.closed && this.pasteBuffer) {
          this.insertAt(this.pasteBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
          void this.render();
        }
        this.pasteBuffer = '';
      }
      return;
    }
  }

  // ─── Key handling ────────────────────────────────────────────────────────

  private onKeypress(str: string, key: readline.Key): void {
    if (this.closed || this.pasteMode) return;
    if (!key) return;

    const name = key.name;
    const seq = key.sequence ?? '';

    // While busy, only Ctrl+C matters (aborts the running session).
    if (this.busy) {
      if (key.ctrl && name === 'c') this.opts.onInterrupt?.();
      return;
    }

    if (name === 'return') {
      if (key.shift || key.ctrl || key.meta || seq === '\n') {
        this.insertAt('\n');
        void this.render();
      } else {
        this.handleEnter();
      }
      return;
    }

    switch (name) {
      case 'backspace':
        if (this.cursor > 0) {
          this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
          this.cursor--;
          this.updateMenu();
          void this.render();
        }
        return;
      case 'delete':
        if (this.cursor < this.text.length) {
          this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
          this.updateMenu();
          void this.render();
        }
        return;
      case 'left':
        if (this.cursor > 0) {
          this.cursor--;
          void this.render();
        }
        return;
      case 'right':
        if (this.cursor < this.text.length) {
          this.cursor++;
          void this.render();
        }
        return;
      case 'up':
        this.handleArrowUpDown(-1);
        return;
      case 'down':
        this.handleArrowUpDown(1);
        return;
      case 'home':
        this.cursor = lineStart(this.text, this.cursor);
        void this.render();
        return;
      case 'end':
        this.cursor = lineEnd(this.text, this.cursor);
        void this.render();
        return;
      case 'tab':
        if (this.menu.length > 0) {
          this.handleEnter();
        } else if (this.text.startsWith('/') && !this.text.includes('\n')) {
          this.updateMenu();
          if (this.menu.length > 0) void this.render();
        }
        return;
      case 'escape':
        if (this.menu.length > 0) {
          this.menu = [];
          void this.render();
        } else if (this.text.length > 0) {
          this.clearInput();
          void this.render();
        }
        return;
      default:
        break;
    }

    // Ctrl / Alt combos
    if (key.ctrl && name === 'c') {
      this.handleCtrlC();
      return;
    }
    if (key.ctrl && name === 'd') {
      if (this.cursor < this.text.length) {
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
        this.updateMenu();
        void this.render();
      }
      return;
    }
    if ((key.ctrl || key.meta) && name === 'left') {
      this.cursor = wordStartBefore(this.text, this.cursor);
      void this.render();
      return;
    }
    if ((key.ctrl || key.meta) && name === 'right') {
      this.cursor = wordEndAfter(this.text, this.cursor);
      void this.render();
      return;
    }
    if (key.ctrl && name === 'a') {
      this.cursor = lineStart(this.text, this.cursor);
      void this.render();
      return;
    }
    if (key.ctrl && name === 'e') {
      this.cursor = lineEnd(this.text, this.cursor);
      void this.render();
      return;
    }
    if (key.ctrl && name === 'w') {
      const start = wordStartBefore(this.text, this.cursor);
      if (start < this.cursor) {
        this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
        this.cursor = start;
        this.updateMenu();
        void this.render();
      }
      return;
    }
    if (key.ctrl && name === 'u') {
      const start = lineStart(this.text, this.cursor);
      if (start < this.cursor) {
        this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
        this.cursor = start;
        this.updateMenu();
        void this.render();
      }
      return;
    }
    if (key.ctrl && name === 'k') {
      const end = lineEnd(this.text, this.cursor);
      if (end > this.cursor) {
        this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
        this.updateMenu();
        void this.render();
      }
      return;
    }
    if (key.ctrl && name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H');
      this.regionTop = null;
      void this.render();
      return;
    }

    // Printable characters (everything not handled above). Control sequences
    // like arrows carry \x1b escapes and are rejected by the regex.
    if (str && /^\P{C}$/u.test(str)) {
      this.insertAt(str);
      void this.render();
    }
  }

  private handleCtrlC(): void {
    if (this.menu.length > 0) {
      this.menu = [];
      void this.render();
      return;
    }
    if (this.text.length > 0) {
      this.clearInput();
      void this.render();
      return;
    }
    const now = Date.now();
    if (now - this.lastCtrlC < 800) {
      this.close();
      this.readPromise?.resolve({ kind: 'exit' });
      return;
    }
    this.lastCtrlC = now;
    void this.closeRegion();
    void this.printLine(chalk.hex(theme.dim)('Press Ctrl+C again to exit.'));
  }

  private handleEnter(): void {
    if (this.menu.length > 0) {
      const sel = this.menu[this.menuIndex];
      this.commit({ kind: 'slash', name: sel.name });
      return;
    }
    if (!this.text.trim()) return;
    this.commit({ kind: 'text', text: this.text });
  }

  private handleArrowUpDown(dir: -1 | 1): void {
    if (this.menu.length > 0) {
      this.menuIndex = (this.menuIndex + dir + this.menu.length) % this.menu.length;
      void this.render();
      return;
    }
    const W = this.width();
    const rows = buildInputRows(this.promptWidth(), this.text, W);
    const pos = posOfIndexInput(rows, this.cursor, this.text);
    if (dir === -1) {
      if (pos.row > 0) {
        this.cursor = indexAtVisualInput(rows, pos.row - 1, pos.col);
        void this.render();
      } else {
        this.historyBack();
      }
    } else {
      if (pos.row < rows.length - 1) {
        this.cursor = indexAtVisualInput(rows, pos.row + 1, pos.col);
        void this.render();
      } else {
        this.historyForward();
      }
    }
  }

  // ─── History ─────────────────────────────────────────────────────────────

  private historyBack(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.pendingText = this.text;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      return;
    }
    this.text = this.history[this.historyIndex];
    this.cursor = this.text.length;
    this.menu = [];
    void this.render();
  }

  private historyForward(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.text = this.history[this.historyIndex];
      this.cursor = this.text.length;
    } else {
      this.historyIndex = -1;
      this.text = this.pendingText ?? '';
      this.cursor = this.text.length;
      this.pendingText = null;
    }
    this.menu = [];
    void this.render();
  }

  // ─── Editing helpers ─────────────────────────────────────────────────────

  private insertAt(s: string): void {
    if (!s) return;
    this.text = this.text.slice(0, this.cursor) + s + this.text.slice(this.cursor);
    this.cursor += s.length;
    this.historyIndex = -1;
    this.pendingText = null;
    this.updateMenu();
  }

  private clearInput(): void {
    this.text = '';
    this.cursor = 0;
    this.menu = [];
    this.historyIndex = -1;
    this.pendingText = null;
  }

  private updateMenu(): void {
    const t = this.text;
    if (!t.startsWith('/') || t.includes('\n')) {
      this.menu = [];
      return;
    }
    const q = t.toLowerCase();
    const all = this.opts.commands ?? [];
    const matches = all.filter(
      (c) =>
        c.name.toLowerCase().startsWith(q) ||
        (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(q))
    );
    this.menu = matches;
    if (this.menuIndex >= matches.length) this.menuIndex = Math.max(0, matches.length - 1);
  }

  // ─── Commit / region handling ────────────────────────────────────────────

  /** Erase the rendered region and print the submitted line as chat output. */
  private commit(submit: CommitSubmit): void {
    if (this.closed) return;
    this.renderChain = this.renderChain.then(() => this.doCommit(submit)).catch(() => {});
  }

  private async doCommit(submit: CommitSubmit): Promise<void> {
    if (submit.kind === 'text') {
      const t = submit.text.trim();
      if (t && this.history[this.history.length - 1] !== t) {
        this.history.push(t);
        if (this.history.length > MAX_HISTORY) this.history.shift();
      }
    }

    await this.eraseRegion();
    if (this.closed) return;

    const shown = submit.kind === 'text' ? submit.text : submit.name;
    const parts = shown.split('\n');
    const styled = `${this.opts.prompt}${parts.join('\r\n')}`;
    process.stdout.write('\r\n' + styled + '\r\n');

    this.regionTop = null;
    this.prevCursorRow = 0;

    const resolve = this.readPromise;
    this.readPromise = null;
    resolve?.resolve(submit);
  }

  /** Erase the rendered region so normal output can take its place. */
  private closeRegion(): Promise<void> {
    this.renderChain = this.renderChain.then(() => this.doCloseRegion()).catch(() => {});
    return this.renderChain;
  }

  private async doCloseRegion(): Promise<void> {
    await this.eraseRegion();
    this.regionTop = null;
    this.prevCursorRow = 0;
  }

  /** Print a single transient line below the (now closed) input region. */
  private printLine(line: string): void {
    this.renderChain = this.renderChain.then(() => {
      process.stdout.write('\r\n' + line + '\r\n');
      this.regionTop = null;
      this.prevCursorRow = 0;
    }).catch(() => {});
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  private width(): number {
    return Math.max(10, (process.stdout.columns ?? 80) - 1);
  }

  private promptWidth(): number {
    return visLen(stripAnsi(this.opts.prompt));
  }

  private render(): Promise<void> {
    this.renderChain = this.renderChain.then(() => this.doRender()).catch(() => {});
    return this.renderChain;
  }

  private async doRender(): Promise<void> {
    if (this.closed) return;
    const W = this.width();
    const promptW = this.promptWidth();

    // Slash menu lines
    const menuLines: string[] = [];
    if (this.menu.length > 0) {
      const max = Math.min(this.menu.length, MAX_MENU_ROWS);
      const startIdx = Math.max(0, Math.min(this.menuIndex - Math.floor(max / 2), this.menu.length - max));
      for (let i = startIdx; i < startIdx + max; i++) {
        menuLines.push(this.menuLine(this.menu[i], i));
      }
    }

    const rows = buildInputRows(promptW, this.text, W);
    const placeholderShown = this.text.length === 0 && !!this.opts.placeholder;

    await this.eraseRegion();
    if (this.closed) return;

    if (menuLines.length > 0) {
      process.stdout.write(menuLines.join('\r\n') + '\r\n');
    }

    // Draw the input
    process.stdout.write(this.opts.prompt);
    if (placeholderShown) {
      process.stdout.write(chalk.hex(theme.dim)(this.opts.placeholder));
    } else {
      process.stdout.write(this.text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    }

    // Place the cursor absolutely. Relative moves after drawing can land on the
    // wrong column because terminals clamp the column when moving up from a
    // wider row; absolute positioning avoids that class of off-by-one.
    const cpos = posOfIndexInput(rows, this.cursor, this.text);
    const absRow = (this.regionTop ?? 1) + menuLines.length + cpos.row;
    const absCol = (cpos.row === 0 ? promptW : 0) + cpos.col;
    process.stdout.write(`\x1b[${absRow};${absCol}H`);

    this.prevCursorRow = menuLines.length + cpos.row;
  }

  private menuLine(item: SlashMenuItem, idx: number): string {
    const W = this.width();
    const selected = idx === this.menuIndex;

    const namePlain = item.name;
    const descPlain = item.description ?? '';
    const descMax = Math.max(6, W - 2 - visLen(namePlain) - 4);
    const descTrunc =
      visLen(descPlain) > descMax ? descPlain.slice(0, descMax - 1) + '…' : descPlain;

    const prefix = selected ? chalk.hex(theme.green).bold(' ❯') : '   ';
    const name = selected
      ? chalk.bgHex(theme.green).hex(theme.black).bold(` ${namePlain} `)
      : chalk.hex(theme.green).bold(namePlain);
    const desc = descTrunc ? chalk.hex(theme.muted)(descTrunc) : '';

    return `${prefix} ${name}  ${desc}`;
  }

  // ─── Erase / cursor position ─────────────────────────────────────────────

  private async eraseRegion(): Promise<void> {
    const pos = await this.cursorPos();
    if (this.closed) return;
    if (this.regionTop === null) {
      // Nothing drawn yet — just record where the region starts.
      this.regionTop = pos.row;
      return;
    }
    const top = pos.row - this.prevCursorRow;
    if (top < 1) {
      // The region scrolled off the top of the screen (rare): full clear.
      process.stdout.write('\x1b[2J\x1b[H');
      this.regionTop = 1;
      return;
    }
    process.stdout.write(`\x1b[${top};1H`);
    process.stdout.write('\x1b[J');
    this.regionTop = top;
  }

  private cursorPos(): Promise<{ row: number; col: number }> {
    if (this.pendingPos) return this.pendingPos.promise;
    let resolveFn!: (p: { row: number; col: number }) => void;
    const promise = new Promise<{ row: number; col: number }>((resolve) => {
      resolveFn = resolve;
    });
    const timer = setTimeout(() => {
      this.pendingPos = null;
      resolveFn({ row: 1, col: 1 });
    }, 150);
    this.pendingPos = { promise, resolve: resolveFn, timer };
    process.stdout.write('\x1b[6n');
    return promise;
  }

  // ─── Non-TTY fallback (piped input, tests, CI) ──────────────────────────

  private readLineNonTTY(): Promise<TextAreaSubmit> {
    return new Promise<TextAreaSubmit>((resolve) => {
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf-8');
        if (buf.includes('\n')) {
          const nl = buf.indexOf('\n');
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          cleanup();
          resolve({ kind: 'text', text: line.replace(/\r$/, '') });
        }
      };
      const onEnd = () => {
        cleanup();
        if (buf.trim()) {
          resolve({ kind: 'text', text: buf.replace(/\r$/, '') });
        } else {
          resolve({ kind: 'exit' });
        }
      };
      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        if (this.nonTTYHandlers) this.nonTTYHandlers = null;
      };
      this.nonTTYHandlers = { onData, onEnd };
      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      process.stdin.resume();
    });
  }
}
