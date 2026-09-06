/**
 * text-area — A true multiline terminal composer (Hermes-agent style).
 *
 * Keys:
 *   Enter                          → send
 *   Ctrl+Enter / Shift+Enter /
 *   Alt+Enter / Ctrl+J             → new line
 *   `\` then Enter                 → new line (fallback for terminals that can't
 *                                    distinguish Ctrl+Enter from Enter)
 *   ↑/↓                            → move between lines; history at the edges
 *   ←/→, Home/End, Ctrl+A/E        → cursor movement
 *   Ctrl+←/→ (Alt+B/F)             → word movement
 *   Ctrl+W / Alt+Backspace         → delete word
 *   Ctrl+U / Ctrl+K                → delete to line start / end
 *   Delete / Ctrl+D                → delete char (Ctrl+D on empty input exits)
 *   Ctrl+L                         → clear screen
 *   Ctrl+G  (or Ctrl+X Ctrl+E)     → edit prompt in $EDITOR
 *   Ctrl+S                         → stash / restore draft
 *   Ctrl+Z                         → suspend (unix)
 *   Tab                            → accept ghost suggestion / complete slash or @path
 *   Esc                            → close menu → clear input
 *   Ctrl+C                         → clear input; twice on empty → exit
 *   /                              → live slash-command menu (commands + skills)
 *   @                              → file path completion menu
 *   Paste                          → bracketed paste; big pastes are collapsed to a
 *                                    placeholder and expanded on submit
 *
 * Rendering: the region (status line + menu + input) is erased and redrawn
 * on every change using cursor-position reports, so it stays correct while
 * the terminal scrolls.
 */

import readline from 'readline';
import { readdirSync, statSync, writeFileSync, readFileSync, unlinkSync, mkdtempSync, mkdirSync } from 'fs';
import { join, dirname, basename, sep } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
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
  /** e.g. "<file> [notes]" — shown dim after the name */
  argumentHint?: string;
  /** 'command' (default) | 'skill' | 'quick' */
  kind?: 'command' | 'skill' | 'quick';
}

export type TextAreaSubmit =
  | { kind: 'text'; text: string }
  | { kind: 'slash'; name: string }
  | { kind: 'exit' };

type CommitSubmit = { kind: 'text'; text: string } | { kind: 'slash'; name: string };

export interface TextAreaOptions {
  prompt: string;
  placeholder?: string;
  commands?: SlashMenuItem[];
  history?: string[];
  /** Called when Ctrl+C is pressed while busy (processing). */
  onInterrupt?: () => void;
  /** Optional status line rendered above the input (called on every redraw). */
  statusLine?: () => string | null;
  /** Working directory for @path completion. */
  cwd?: string;
  /** Called when the user submits text while busy (queue / steer). */
  onBusySubmit?: (text: string) => void;
  /** Persist history to this file (one JSON array). */
  historyFile?: string;
}

interface MenuState {
  kind: 'slash' | 'file';
  items: SlashMenuItem[];
  index: number;
  /** For file menu: the token range being completed */
  tokenStart?: number;
  tokenEnd?: number;
}

const MAX_MENU_ROWS = 10;
const MAX_HISTORY = 200;
const PASTE_COLLAPSE_LINES = 4;
const PASTE_COLLAPSE_CHARS = 400;

export class TextArea {
  private opts: TextAreaOptions;
  private text = '';
  private cursor = 0;
  private history: string[];
  private historyIndex = -1;
  private pendingText: string | null = null;
  private menu: MenuState | null = null;
  private stash: string[] = [];
  private pastes: Map<number, string> = new Map();
  private pasteCounter = 0;
  private ghost = '';

  private busy = false;
  private closed = false;
  private readPromise: { resolve: (v: TextAreaSubmit) => void } | null = null;
  private nonTTYHandlers: { onData: (c: Buffer) => void; onEnd: () => void } | null = null;

  // Rendering state
  private regionTop: number | null = null;
  private prevCursorRow = 0;
  private renderChain: Promise<void> = Promise.resolve();

  // Input state
  private lastCtrlC = 0;
  private pasteMode = false;
  private pasteBuffer = '';
  private rawEnabled = false;
  private kittyEnabled = false;
  private ctrlXPending = false;
  private keyHandler: (str: string, key: readline.Key) => void = () => {};
  private dataHandler: (chunk: Buffer) => void = () => {};
  private resizeHandler: () => void = () => {};

  constructor(opts: TextAreaOptions) {
    this.opts = opts;
    this.history = [...(opts.history ?? [])];
    if (opts.historyFile) this.loadHistory(opts.historyFile);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  setBusy(b: boolean): void {
    this.busy = b;
  }

  isBusy(): boolean {
    return this.busy;
  }

  setCommands(commands: SlashMenuItem[]): void {
    this.opts.commands = commands;
  }

  setPrompt(prompt: string): void {
    this.opts.prompt = prompt;
  }

  /** Pre-fill the composer (used by /retry, /prompt). */
  setText(text: string): void {
    this.text = text;
    this.cursor = text.length;
    this.menu = null;
    if (this.readPromise) void this.render();
  }

  getText(): string {
    return this.text;
  }

  /** Redraw the region (e.g. after status changes). */
  refresh(): void {
    if (this.readPromise && !this.busy) void this.render();
  }

  /** Print a line above the input while it's active. */
  log(line: string): void {
    if (!this.readPromise || !process.stdin.isTTY) {
      process.stdout.write(line + '\n');
      return;
    }
    this.renderChain = this.renderChain
      .then(async () => {
        await this.eraseRegion();
        process.stdout.write(line.replace(/\n/g, '\r\n') + '\r\n');
        this.regionTop = null;
        this.prevCursorRow = 0;
        await this.doRender();
      })
      .catch(() => {});
  }

  async read(): Promise<TextAreaSubmit> {
    if (!process.stdin.isTTY) return this.readLineNonTTY();
    this.ensureInput();
    this.rearmInput();
    if (this.readPromise) throw new Error('TextArea.read() already pending');
    this.clearInput();
    const promise = new Promise<TextAreaSubmit>(resolve => {
      this.readPromise = { resolve };
    });
    void this.render();
    return promise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.disableKitty();
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
    if (typeof (process.stdout as any).removeListener === 'function') process.stdout.removeListener('resize', this.resizeHandler);
    if (this.nonTTYHandlers) {
      process.stdin.removeListener('data', this.nonTTYHandlers.onData);
      process.stdin.removeListener('end', this.nonTTYHandlers.onEnd);
      this.nonTTYHandlers = null;
    }
    if (this.opts.historyFile) this.saveHistory(this.opts.historyFile);
    this.readPromise?.resolve({ kind: 'exit' });
    this.readPromise = null;
  }

  getHistory(): string[] {
    return [...this.history];
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
    this.enableKitty();

    this.keyHandler = (str: string, key: readline.Key) => this.onKeypress(str, key);
    this.dataHandler = (chunk: Buffer) => this.onData(chunk);
    this.resizeHandler = () => {
      if (this.readPromise && !this.busy) void this.render();
    };

    process.stdin.on('keypress', this.keyHandler);
    process.stdin.prependListener('data', this.dataHandler);
    if (typeof (process.stdout as any).on === 'function') process.stdout.on('resize', this.resizeHandler);
    // Bracketed paste
    process.stdout.write('\x1b[?2004h');
  }

  /**
   * Re-assert raw mode + flowing stdin. Spinners, child processes and prompt
   * libraries may pause stdin or drop raw mode between turns; if stdin stays
   * paused the event loop drains and the process silently exits.
   */
  private rearmInput(): void {
    try {
      if (process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
    } catch {
      /* ignore */
    }
    const stdin = process.stdin as any;
    if (typeof stdin.isPaused !== 'function' || stdin.isPaused()) stdin.resume?.();
    if (typeof stdin.ref === 'function') stdin.ref();
  }

  /** Ask terminals that support the kitty keyboard protocol to disambiguate Ctrl/Shift+Enter. */
  private enableKitty(): void {
    if (process.env.MYCODE_NO_KITTY) return;
    try {
      process.stdout.write('\x1b[>1u');
      this.kittyEnabled = true;
    } catch {
      /* ignore */
    }
  }

  private disableKitty(): void {
    if (!this.kittyEnabled) return;
    try {
      process.stdout.write('\x1b[<u');
      process.stdout.write('\x1b[?2004l');
    } catch {
      /* ignore */
    }
    this.kittyEnabled = false;
  }

  // ─── Raw data (paste + cursor position + modified Enter) ─────────────────

  private onData(chunk: Buffer): void {
    let s = chunk.toString('utf-8');

    // Swallow stray terminal reports (cursor position, device attributes, focus events).
    if (/\x1b\[(?:\d+;\d+R|\?[\d;]*c|>[\d;]*c|[IO])/.test(s)) {
      const rest = s.replace(/\x1b\[(?:\d+;\d+R|\?[\d;]*c|>[\d;]*c|[IO])/g, '');
      if (rest) process.stdin.emit('data', Buffer.from(rest));
      return;
    }

    // Modified Enter as CSI-u (kitty/WezTerm/Windows Terminal/foot) or
    // xterm modifyOtherKeys: \x1b[13;<mod>u  |  \x1b[27;<mod>;13~
    const modEnter = /\x1b\[(?:13;(\d+)u|27;(\d+);13~)/g;
    if (modEnter.test(s)) {
      modEnter.lastIndex = 0;
      let count = 0;
      s = s.replace(modEnter, () => {
        count++;
        return '';
      });
      if (!this.busy && !this.closed) {
        for (let i = 0; i < count; i++) this.insertAt('\n');
        void this.render();
      }
      if (s) process.stdin.emit('data', Buffer.from(s));
      return;
    }
    // Plain Enter in kitty mode may arrive as \x1b[13u (no modifier) — treat as Enter
    if (/\x1b\[13u/.test(s)) {
      s = s.replace(/\x1b\[13u/g, '');
      if (!this.busy && !this.closed) this.handleEnter();
      if (s) process.stdin.emit('data', Buffer.from(s));
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
          this.insertPaste(this.pasteBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
          void this.render();
        }
        this.pasteBuffer = '';
      }
      return;
    }
  }

  private insertPaste(text: string): void {
    const lines = text.split('\n').length;
    if (lines > PASTE_COLLAPSE_LINES || text.length > PASTE_COLLAPSE_CHARS) {
      const id = ++this.pasteCounter;
      this.pastes.set(id, text);
      this.insertAt(`[Pasted text #${id}: ${lines} lines, ${text.length.toLocaleString()} chars]`);
    } else {
      this.insertAt(text);
    }
  }

  /** Replace paste placeholders with their content. */
  private expandPastes(text: string): string {
    if (this.pastes.size === 0) return text;
    return text.replace(/\[Pasted text #(\d+): [^\]]*\]/g, (m, id) => this.pastes.get(Number(id)) ?? m);
  }

  // ─── Key handling ────────────────────────────────────────────────────────

  private onKeypress(str: string, key: readline.Key): void {
    if (this.closed || this.pasteMode) return;
    if (!key) return;

    const name = key.name;
    const seq = key.sequence ?? '';

    // Unknown escape sequences (terminal replies, unmapped keys) must never be inserted as text.
    if (seq.startsWith('\x1b') && (name === undefined || name === 'undefined') && !key.meta) return;
    if (name === 'undefined' && !str) return;

    // While busy: Ctrl+C interrupts; Enter with text queues/steers; typing still edits.
    if (this.busy) {
      if (key.ctrl && name === 'c') {
        this.opts.onInterrupt?.();
        return;
      }
      if (name === 'return' && !key.shift && !key.ctrl && !key.meta && seq !== '\n') {
        const t = this.text.trim();
        if (t && this.opts.onBusySubmit) {
          this.opts.onBusySubmit(this.expandPastes(t));
          this.clearInput();
          void this.render();
        }
        return;
      }
      // fall through: allow editing the draft while the agent works
    }

    // Ctrl+X Ctrl+E (emacs) → external editor
    if (this.ctrlXPending) {
      this.ctrlXPending = false;
      if (key.ctrl && name === 'e') {
        void this.openExternalEditor();
        return;
      }
    }
    if (key.ctrl && name === 'x') {
      this.ctrlXPending = true;
      return;
    }

    if (name === 'return' || name === 'enter' || seq === '\n' || seq === '\r') {
      const wantsNewline = key.shift || key.ctrl || key.meta || seq === '\n' || name === 'enter';
      if (wantsNewline) {
        this.insertAt('\n');
        void this.render();
        return;
      }
      // Backslash continuation: "foo\" + Enter → newline
      if (this.cursor > 0 && this.text[this.cursor - 1] === '\\' && !this.menu) {
        this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
        this.cursor--;
        this.insertAt('\n');
        void this.render();
        return;
      }
      this.handleEnter();
      return;
    }

    switch (name) {
      case 'backspace':
        if (key.meta) {
          this.deleteWordBefore();
          return;
        }
        if (this.cursor > 0) {
          this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
          this.cursor--;
          this.afterEdit();
        }
        return;
      case 'delete':
        if (this.cursor < this.text.length) {
          this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
          this.afterEdit();
        }
        return;
      case 'left':
        if (key.ctrl || key.meta) {
          this.cursor = wordStartBefore(this.text, this.cursor);
        } else if (this.cursor > 0) this.cursor--;
        void this.render();
        return;
      case 'right':
        if (key.ctrl || key.meta) {
          this.cursor = wordEndAfter(this.text, this.cursor);
        } else if (this.cursor < this.text.length) this.cursor++;
        else if (this.ghost) this.acceptGhost();
        void this.render();
        return;
      case 'up':
        this.handleArrowUpDown(-1);
        return;
      case 'down':
        this.handleArrowUpDown(1);
        return;
      case 'pageup':
      case 'pagedown':
        if (this.menu) {
          const n = this.menu.items.length;
          this.menu.index = name === 'pageup' ? Math.max(0, this.menu.index - MAX_MENU_ROWS) : Math.min(n - 1, this.menu.index + MAX_MENU_ROWS);
          void this.render();
        }
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
        this.handleTab(!!key.shift);
        return;
      case 'escape':
        if (this.menu) {
          this.menu = null;
          void this.render();
        } else if (this.text.length > 0) {
          this.clearInput();
          void this.render();
        }
        return;
      default:
        break;
    }

    if (key.ctrl) {
      switch (name) {
        case 'c':
          this.handleCtrlC();
          return;
        case 'd':
          if (this.text.length === 0) {
            this.exit();
          } else if (this.cursor < this.text.length) {
            this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
            this.afterEdit();
          }
          return;
        case 'a':
          this.cursor = lineStart(this.text, this.cursor);
          void this.render();
          return;
        case 'e':
          this.cursor = lineEnd(this.text, this.cursor);
          void this.render();
          return;
        case 'b':
          if (this.cursor > 0) this.cursor--;
          void this.render();
          return;
        case 'f':
          if (this.cursor < this.text.length) this.cursor++;
          void this.render();
          return;
        case 'w':
          this.deleteWordBefore();
          return;
        case 'u': {
          const start = lineStart(this.text, this.cursor);
          if (start < this.cursor) {
            this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
            this.cursor = start;
            this.afterEdit();
          }
          return;
        }
        case 'k': {
          const end = lineEnd(this.text, this.cursor);
          if (end > this.cursor) {
            this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
            this.afterEdit();
          }
          return;
        }
        case 'l':
          process.stdout.write('\x1b[2J\x1b[H');
          this.regionTop = null;
          void this.render();
          return;
        case 'g':
          void this.openExternalEditor();
          return;
        case 's':
          this.toggleStash();
          return;
        case 'z':
          this.suspend();
          return;
        case 'j':
          this.insertAt('\n');
          void this.render();
          return;
        default:
          return;
      }
    }

    if (key.meta) {
      if (name === 'b') {
        this.cursor = wordStartBefore(this.text, this.cursor);
        void this.render();
        return;
      }
      if (name === 'f') {
        this.cursor = wordEndAfter(this.text, this.cursor);
        void this.render();
        return;
      }
      if (name === 'd') {
        const end = wordEndAfter(this.text, this.cursor);
        this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
        this.afterEdit();
        return;
      }
    }

    // Printable characters (control sequences carry \x1b and are rejected)
    if (str && !key.ctrl && !key.meta && /^\P{C}+$/u.test(str)) {
      this.insertAt(str);
      void this.render();
    }
  }

  private afterEdit(): void {
    this.historyIndex = -1;
    this.pendingText = null;
    this.updateMenu();
    void this.render();
  }

  private deleteWordBefore(): void {
    const start = wordStartBefore(this.text, this.cursor);
    if (start < this.cursor) {
      this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
      this.cursor = start;
      this.afterEdit();
    }
  }

  private handleTab(reverse: boolean): void {
    if (this.menu) {
      if (this.menu.kind === 'file') {
        this.applyFileCompletion();
        return;
      }
      if (this.menu.items.length > 1 && reverse) {
        this.menu.index = (this.menu.index - 1 + this.menu.items.length) % this.menu.items.length;
        void this.render();
        return;
      }
      // Complete the command name into the buffer (keep typing args)
      const sel = this.menu.items[this.menu.index];
      this.text = sel.name + ' ';
      this.cursor = this.text.length;
      this.menu = null;
      void this.render();
      return;
    }
    if (this.ghost) {
      this.acceptGhost();
      void this.render();
      return;
    }
    if (this.text.startsWith('/') && !this.text.includes('\n')) {
      this.updateMenu();
      void this.render();
      return;
    }
    // Try @path completion at cursor
    this.updateFileMenu(true);
    void this.render();
  }

  private acceptGhost(): void {
    if (!this.ghost) return;
    this.text += this.ghost;
    this.cursor = this.text.length;
    this.ghost = '';
  }

  private handleCtrlC(): void {
    if (this.menu) {
      this.menu = null;
      void this.render();
      return;
    }
    if (this.text.length > 0) {
      this.clearInput();
      void this.render();
      return;
    }
    const now = Date.now();
    if (now - this.lastCtrlC < 2000) {
      this.exit();
      return;
    }
    this.lastCtrlC = now;
    void this.closeRegion();
    void this.printLine(chalk.hex(theme.dim)('  Press Ctrl+C again to exit (or Ctrl+D).'));
  }

  private exit(): void {
    const resolve = this.readPromise;
    this.close();
    resolve?.resolve({ kind: 'exit' });
  }

  private handleEnter(): void {
    if (this.menu) {
      if (this.menu.kind === 'file') {
        this.applyFileCompletion();
        return;
      }
      const sel = this.menu.items[this.menu.index];
      // If the command takes arguments, complete it and let the user type them.
      if (sel.argumentHint && this.text.trim() !== sel.name) {
        this.text = sel.name + ' ';
        this.cursor = this.text.length;
        this.menu = null;
        void this.render();
        return;
      }
      this.commit({ kind: 'slash', name: sel.name });
      return;
    }
    if (!this.text.trim()) return;
    this.commit({ kind: 'text', text: this.expandPastes(this.text) });
  }

  private handleArrowUpDown(dir: -1 | 1): void {
    if (this.menu) {
      const n = this.menu.items.length;
      this.menu.index = (this.menu.index + dir + n) % n;
      void this.render();
      return;
    }
    const W = this.width();
    const rows = buildInputRows(this.promptWidth(), this.text, W, this.promptWidth());
    const pos = posOfIndexInput(rows, this.cursor, this.text);
    if (dir === -1) {
      if (pos.row > 0) {
        this.cursor = indexAtVisualInput(rows, pos.row - 1, pos.col);
        void this.render();
      } else this.historyBack();
    } else {
      if (pos.row < rows.length - 1) {
        this.cursor = indexAtVisualInput(rows, pos.row + 1, pos.col);
        void this.render();
      } else this.historyForward();
    }
  }

  // ─── Stash / editor / suspend ────────────────────────────────────────────

  private toggleStash(): void {
    if (this.text.trim()) {
      this.stash.push(this.text);
      this.clearInput();
      void this.closeRegion();
      void this.printLine(chalk.hex(theme.dim)(`  📌 Draft stashed (${this.stash.length}). Press Ctrl+S on an empty prompt to restore.`));
      void this.render();
      return;
    }
    const d = this.stash.pop();
    if (d !== undefined) {
      this.text = d;
      this.cursor = d.length;
      void this.render();
    }
  }

  get stashCount(): number {
    return this.stash.length;
  }

  private async openExternalEditor(): Promise<void> {
    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    const dir = mkdtempSync(join(tmpdir(), 'mycode-'));
    const file = join(dir, 'PROMPT.md');
    writeFileSync(file, this.text, 'utf-8');

    await this.closeRegion();
    const wasRaw = this.rawEnabled;
    this.disableKitty();
    if (wasRaw) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
    }
    process.stdin.pause();
    try {
      const [cmd, ...args] = editor.split(' ');
      spawnSync(cmd, [...args, file], { stdio: 'inherit' });
      const edited = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
      this.text = edited;
      this.cursor = edited.length;
    } catch (err: any) {
      void this.printLine(chalk.hex(theme.red)(`  ✖ Editor failed: ${err.message}`));
    } finally {
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
      if (wasRaw) {
        try {
          process.stdin.setRawMode(true);
        } catch {
          /* ignore */
        }
      }
      process.stdin.resume();
      this.enableKitty();
      process.stdout.write('\x1b[?2004h');
      this.regionTop = null;
      void this.render();
    }
  }

  private suspend(): void {
    if (process.platform === 'win32') return;
    void this.closeRegion().then(() => {
      this.disableKitty();
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      process.once('SIGCONT', () => {
        try {
          process.stdin.setRawMode(true);
        } catch {
          /* ignore */
        }
        this.enableKitty();
        process.stdout.write('\x1b[?2004h');
        this.regionTop = null;
        void this.render();
      });
      process.kill(process.pid, 'SIGTSTP');
    });
  }

  // ─── History ─────────────────────────────────────────────────────────────

  private historyBack(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.pendingText = this.text;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) this.historyIndex--;
    else return;
    this.text = this.history[this.historyIndex];
    this.cursor = this.text.length;
    this.menu = null;
    void this.render();
  }

  private historyForward(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.text = this.history[this.historyIndex];
    } else {
      this.historyIndex = -1;
      this.text = this.pendingText ?? '';
      this.pendingText = null;
    }
    this.cursor = this.text.length;
    this.menu = null;
    void this.render();
  }

  private loadHistory(file: string): void {
    try {
      const arr = JSON.parse(readFileSync(file, 'utf-8'));
      if (Array.isArray(arr)) this.history = arr.filter(x => typeof x === 'string').slice(-MAX_HISTORY);
    } catch {
      /* none */
    }
  }

  private saveHistory(file: string): void {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(this.history.slice(-MAX_HISTORY)), 'utf-8');
    } catch {
      /* ignore */
    }
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
    this.menu = null;
    this.ghost = '';
    this.historyIndex = -1;
    this.pendingText = null;
  }

  private updateMenu(): void {
    const t = this.text;
    // Slash menu: only while typing the command word itself (no space / newline yet)
    if (t.startsWith('/') && !t.includes('\n') && !t.includes(' ')) {
      const q = t.toLowerCase();
      const all = this.opts.commands ?? [];
      const starts = all.filter(c => c.name.toLowerCase().startsWith(q) || (c.aliases ?? []).some(a => a.toLowerCase().startsWith(q)));
      const contains = q.length > 2 ? all.filter(c => !starts.includes(c) && c.name.toLowerCase().includes(q.slice(1))) : [];
      const items = [...starts, ...contains];
      if (items.length) {
        const prevIdx = this.menu?.kind === 'slash' ? this.menu.index : 0;
        this.menu = { kind: 'slash', items, index: Math.min(prevIdx, items.length - 1) };
        this.ghost = '';
        return;
      }
      this.menu = null;
      return;
    }
    // @path menu
    if (this.updateFileMenu(false)) return;
    this.menu = null;
    this.updateGhost();
  }

  private updateGhost(): void {
    this.ghost = '';
    if (!this.text || this.text.length < 3 || this.cursor !== this.text.length || this.text.includes('\n')) return;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.length > this.text.length && h.startsWith(this.text) && !h.includes('\n')) {
        this.ghost = h.slice(this.text.length);
        return;
      }
    }
  }

  /** Build a file-completion menu for an `@token` under the cursor. Returns true if shown. */
  private updateFileMenu(force: boolean): boolean {
    const before = this.text.slice(0, this.cursor);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) {
      if (this.menu?.kind === 'file') this.menu = null;
      return false;
    }
    const partial = m[1];
    if (!force && partial.length === 0 && this.menu?.kind !== 'file') {
      // show top-level listing immediately after typing '@'
    }
    const tokenStart = this.cursor - partial.length;
    const cwd = this.opts.cwd ?? process.cwd();
    const items = this.completePath(cwd, partial).map(p => ({ name: p, description: '' }));
    if (!items.length) {
      this.menu = null;
      return false;
    }
    const prevIdx = this.menu?.kind === 'file' ? this.menu.index : 0;
    this.menu = { kind: 'file', items, index: Math.min(prevIdx, items.length - 1), tokenStart, tokenEnd: this.cursor };
    return true;
  }

  private completePath(cwd: string, partial: string): string[] {
    const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'target']);
    const slash = partial.lastIndexOf('/');
    const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
    const filePart = slash >= 0 ? partial.slice(slash + 1) : partial;
    const dirAbs = join(cwd, dirPart);
    let entries: string[] = [];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return [];
    }
    const q = filePart.toLowerCase();
    const out: string[] = [];
    for (const e of entries) {
      if (IGNORE.has(e)) continue;
      if (q && !e.toLowerCase().startsWith(q)) continue;
      if (!q && e.startsWith('.') && !filePart.startsWith('.')) continue;
      let isDir = false;
      try {
        isDir = statSync(join(dirAbs, e)).isDirectory();
      } catch {
        continue;
      }
      out.push(dirPart + e + (isDir ? '/' : ''));
    }
    // fuzzy fallback: substring match
    if (out.length === 0 && q) {
      for (const e of entries) {
        if (IGNORE.has(e) || !e.toLowerCase().includes(q)) continue;
        let isDir = false;
        try {
          isDir = statSync(join(dirAbs, e)).isDirectory();
        } catch {
          continue;
        }
        out.push(dirPart + e + (isDir ? '/' : ''));
      }
    }
    out.sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1));
    return out.slice(0, 40);
  }

  private applyFileCompletion(): void {
    if (!this.menu || this.menu.kind !== 'file') return;
    const sel = this.menu.items[this.menu.index].name;
    const start = this.menu.tokenStart ?? this.cursor;
    const end = this.menu.tokenEnd ?? this.cursor;
    const isDir = sel.endsWith('/');
    this.text = this.text.slice(0, start) + sel + (isDir ? '' : ' ') + this.text.slice(end);
    this.cursor = start + sel.length + (isDir ? 0 : 1);
    this.menu = null;
    if (isDir) this.updateFileMenu(true);
    void this.render();
  }

  // ─── Commit / region handling ────────────────────────────────────────────

  private commit(submit: CommitSubmit): void {
    if (this.closed) return;
    this.renderChain = this.renderChain.then(() => this.doCommit(submit)).catch(() => {});
  }

  private async doCommit(submit: CommitSubmit): Promise<void> {
    const shownText = submit.kind === 'text' ? this.text : submit.name;
    if (submit.kind === 'text') {
      const t = this.text.trim();
      if (t && this.history[this.history.length - 1] !== t) {
        this.history.push(t);
        if (this.history.length > MAX_HISTORY) this.history.shift();
      }
      if (this.opts.historyFile) this.saveHistory(this.opts.historyFile);
    }

    await this.eraseRegion();
    if (this.closed) return;

    const parts = shownText.split('\n');
    const cont = ' '.repeat(Math.max(0, this.promptWidth() - 2)) + chalk.hex(theme.dim)('│ ');
    const styled = `${this.opts.prompt}${parts.map((l, i) => (i === 0 ? l : cont + l)).join('\r\n')}`;
    process.stdout.write('\r\n' + styled + '\r\n');

    this.regionTop = null;
    this.prevCursorRow = 0;
    this.ghost = '';

    const resolve = this.readPromise;
    this.readPromise = null;
    resolve?.resolve(submit);
  }

  private closeRegion(): Promise<void> {
    this.renderChain = this.renderChain.then(() => this.doCloseRegion()).catch(() => {});
    return this.renderChain;
  }

  private async doCloseRegion(): Promise<void> {
    await this.eraseRegion();
    this.regionTop = null;
    this.prevCursorRow = 0;
  }

  private printLine(line: string): void {
    this.renderChain = this.renderChain
      .then(() => {
        process.stdout.write('\r\n' + line + '\r\n');
        this.regionTop = null;
        this.prevCursorRow = 0;
      })
      .catch(() => {});
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
    if (this.closed || !this.readPromise) return;
    const W = this.width();
    const promptW = this.promptWidth();

    const headerLines: string[] = [];
    const status = this.opts.statusLine?.();
    if (status) headerLines.push(status);

    const menuLines: string[] = [];
    if (this.menu) {
      const items = this.menu.items;
      const max = Math.min(items.length, MAX_MENU_ROWS);
      const startIdx = Math.max(0, Math.min(this.menu.index - Math.floor(max / 2), items.length - max));
      for (let i = startIdx; i < startIdx + max; i++) menuLines.push(this.menuLine(items[i], i));
      if (items.length > max) menuLines.push(chalk.hex(theme.dim)(`    … ${items.length - max} more · ↑/↓ to scroll · Tab to complete`));
    }

    const rows = buildInputRows(promptW, this.text, W, promptW);
    const placeholderShown = this.text.length === 0 && !!this.opts.placeholder;

    await this.eraseRegion();
    if (this.closed) return;

    const above = [...headerLines, ...menuLines];
    if (above.length) process.stdout.write(above.join('\r\n') + '\r\n');

    process.stdout.write(this.opts.prompt);
    if (placeholderShown) {
      process.stdout.write(chalk.hex(theme.dim)(this.opts.placeholder));
    } else {
      const cont = ' '.repeat(Math.max(0, promptW - 2)) + chalk.hex(theme.dim)('│ ');
      const body = this.text.replace(/\r\n/g, '\n').split('\n');
      // Continuation lines get a subtle gutter so multi-line prompts read well.
      // (Row math in text-area-utils assumes full width for continuation rows,
      //  which still holds because the gutter replaces the prompt width.)
      const rendered = body.map((l, i) => (i === 0 ? l : cont + l)).join('\r\n');
      process.stdout.write(this.highlight(rendered));
      if (this.ghost) process.stdout.write(chalk.hex(theme.dim)(this.ghost));
    }

    const cpos = posOfIndexInput(rows, this.cursor, this.text);
    // First row of every logical line is prefixed by the prompt (row 0) or the gutter.
    const rowStart = rows[cpos.row]?.start ?? 0;
    const isLogicalLineStart = rowStart === 0 || this.text[rowStart - 1] === '\n';
    const gutter = isLogicalLineStart ? promptW : 0;
    const col = gutter + cpos.col;
    // The cursor currently sits on the last drawn row; move up to the target row.
    const totalRows = placeholderShown ? 1 : Math.max(1, rows.length);
    const lastRow = above.length + totalRows - 1;
    const targetRow = above.length + cpos.row;
    const up = lastRow - targetRow;
    if (up > 0) process.stdout.write(`\x1b[${up}A`);
    process.stdout.write('\r');
    if (col > 0) process.stdout.write(`\x1b[${col}C`);
    this.regionTop = 1;
    this.prevCursorRow = targetRow;
  }

  /** Light syntax colouring for the composer: slash cmd, @paths, !shell, paste placeholders. */
  private highlight(s: string): string {
    if (s.startsWith('/')) {
      const sp = s.indexOf(' ');
      const cmd = sp === -1 ? s : s.slice(0, sp);
      return chalk.hex(theme.green).bold(cmd) + (sp === -1 ? '' : s.slice(sp));
    }
    if (s.startsWith('!')) return chalk.hex(theme.amber)(s);
    return s
      .replace(/(^|\s)(@[^\s@]+)/g, (_m, pre, tok) => pre + chalk.hex(theme.greenGlow)(tok))
      .replace(/\[Pasted text #\d+: [^\]]*\]/g, m => chalk.hex(theme.amber)(m));
  }

  private menuLine(item: SlashMenuItem, idx: number): string {
    const W = this.width();
    const selected = !!this.menu && idx === this.menu.index;
    const isFile = this.menu?.kind === 'file';

    const namePlain = isFile ? basename(item.name.replace(/\/$/, '')) + (item.name.endsWith('/') ? '/' : '') : item.name;
    const hint = item.argumentHint ? ` ${item.argumentHint}` : '';
    const descPlain = isFile ? dirname(item.name) === '.' ? '' : dirname(item.name) + sep : item.description ?? '';
    const descMax = Math.max(6, W - 2 - visLen(namePlain) - visLen(hint) - 6);
    const descTrunc = visLen(descPlain) > descMax ? descPlain.slice(0, descMax - 1) + '…' : descPlain;

    const prefix = selected ? chalk.hex(theme.green).bold(' ❯') : '  ';
    const badge = item.kind === 'skill' ? chalk.hex(theme.amber)('◆ ') : item.kind === 'quick' ? chalk.hex(theme.greenGlow)('⚡') : isFile ? chalk.hex(theme.greenGlow)(item.name.endsWith('/') ? '▸ ' : '· ') : '  ';
    const name = selected ? chalk.bgHex(theme.green).hex(theme.black).bold(` ${namePlain} `) : chalk.hex(theme.green).bold(namePlain);
    const hintS = hint ? chalk.hex(theme.dim)(hint) : '';
    const desc = descTrunc ? chalk.hex(theme.muted)(descTrunc) : '';

    return `${prefix} ${badge}${name}${hintS}  ${desc}`;
  }

  // ─── Erase / cursor position ─────────────────────────────────────────────

  /**
   * Erase everything we drew last time. Purely relative cursor movement —
   * we never ask the terminal for its cursor position (DSR replies leak into
   * the input on Windows/ConPTY and some multiplexers).
   */
  private async eraseRegion(): Promise<void> {
    if (this.closed) return;
    if (this.regionTop === null) return; // nothing drawn yet
    if (this.prevCursorRow > 0) process.stdout.write(`\x1b[${this.prevCursorRow}A`);
    process.stdout.write('\r\x1b[J');
  }

  // ─── Non-TTY fallback (piped input, tests, CI) ──────────────────────────

  private nonTTYBuf = '';
  private nonTTYEnded = false;

  private readLineNonTTY(): Promise<TextAreaSubmit> {
    return new Promise<TextAreaSubmit>(resolve => {
      const takeLine = (): TextAreaSubmit | null => {
        const nl = this.nonTTYBuf.indexOf('\n');
        if (nl !== -1) {
          const line = this.nonTTYBuf.slice(0, nl);
          this.nonTTYBuf = this.nonTTYBuf.slice(nl + 1);
          return { kind: 'text', text: line.replace(/\r$/, '') };
        }
        if (this.nonTTYEnded) {
          const rest = this.nonTTYBuf;
          this.nonTTYBuf = '';
          return rest.trim() ? { kind: 'text', text: rest.replace(/\r$/, '') } : { kind: 'exit' };
        }
        return null;
      };
      const ready = takeLine();
      if (ready) return resolve(ready);

      const onData = (chunk: Buffer) => {
        this.nonTTYBuf += chunk.toString('utf-8');
        const r = takeLine();
        if (r) {
          cleanup();
          resolve(r);
        }
      };
      const onEnd = () => {
        this.nonTTYEnded = true;
        cleanup();
        resolve(takeLine() ?? { kind: 'exit' });
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
