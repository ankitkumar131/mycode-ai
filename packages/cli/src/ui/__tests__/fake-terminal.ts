/**
 * A minimal terminal emulator, just real enough to test the composer's redraw.
 *
 * The composer redraws by emitting cursor moves (`ESC [ n A`), carriage returns
 * and `ESC [ J` erases, and trusting that the physical cursor is where the row
 * arithmetic says it is. When that trust is broken — because a line wrapped, or
 * because the host console ignores ANSI at all — you get the classic symptom of
 * every redraw appending a fresh copy of the status line instead of replacing
 * the previous one.
 *
 * Testing that requires modelling actual cursor positions, so this class keeps a
 * screen buffer and applies the escape sequences the composer emits.
 */
export class FakeTerminal {
  readonly width: number;
  readonly height: number;
  /** Screen rows. Each is a sparse array of single-column characters. */
  private screen: string[][] = [];
  private row = 0;
  private col = 0;
  /** When false, escape sequences are printed as literal text (a console with
   *  VT processing off — the Windows default in some hosts). */
  private ansiEnabled = true;
  /** Everything written, including escapes, for debugging failures. */
  readonly raw: string[] = [];

  constructor(opts: { width?: number; height?: number; ansi?: boolean; startRow?: number } = {}) {
    this.width = opts.width ?? 80;
    this.height = opts.height ?? 24;
    this.ansiEnabled = opts.ansi !== false;
    this.row = opts.startRow ?? 0;
    for (let i = 0; i < this.height; i++) this.screen.push([]);
  }

  write(chunk: string): void {
    this.raw.push(chunk);
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];

      if (ch === '\x1b' && this.ansiEnabled) {
        const consumed = this.applyEscape(chunk, i);
        if (consumed > 0) {
          i += consumed;
          continue;
        }
        // Unrecognised escape: skip the whole sequence so it cannot corrupt text.
        i += this.skipEscape(chunk, i);
        continue;
      }

      if (ch === '\r') {
        this.col = 0;
        i++;
        continue;
      }
      if (ch === '\n') {
        this.row++;
        if (this.row >= this.height) this.scroll();
        i++;
        continue;
      }
      if (ch === '\t') {
        this.col = Math.min(this.width - 1, (Math.floor(this.col / 8) + 1) * 8);
        i++;
        continue;
      }
      if (ch === '\x07') {
        i++;
        continue;
      }

      this.put(ch);
      i++;
    }
  }

  private put(ch: string): void {
    if (this.col >= this.width) {
      // Auto-wrap: terminals move to the next line when a character is written
      // past the last column.
      this.col = 0;
      this.row++;
      if (this.row >= this.height) this.scroll();
    }
    if (!this.screen[this.row]) this.screen[this.row] = [];
    this.screen[this.row][this.col] = ch;
    this.col++;
  }

  private scroll(): void {
    this.screen.shift();
    this.screen.push([]);
    this.row = this.height - 1;
  }

  /** Returns characters consumed, or 0 when the sequence is not recognised. */
  private applyEscape(s: string, start: number): number {
    // CSI: ESC [ params final
    if (s[start + 1] === '[') {
      let j = start + 2;
      let params = '';
      while (j < s.length && /[0-9;?><=]/.test(s[j])) {
        params += s[j];
        j++;
      }
      const final = s[j];
      if (final === undefined) return 0;
      const n = parseInt(params.replace(/[^0-9]/g, ''), 10);
      const count = Number.isFinite(n) && n > 0 ? n : 1;

      switch (final) {
        case 'A':
          this.row = Math.max(0, this.row - count);
          break;
        case 'B':
          this.row = Math.min(this.height - 1, this.row + count);
          break;
        case 'C':
          this.col = Math.min(this.width - 1, this.col + count);
          break;
        case 'D':
          this.col = Math.max(0, this.col - count);
          break;
        case 'H':
        case 'f':
          this.row = 0;
          this.col = 0;
          break;
        case 'J':
          if (params.startsWith('2')) this.clearAll();
          else this.eraseToEndOfScreen();
          break;
        case 'K':
          this.eraseLine(params.startsWith('2') ? 'all' : 'toEnd');
          break;
        default:
          break; // mode set/reset, kitty protocol, etc. — no cursor effect
      }
      return j + 1 - start;
    }
    return 0;
  }

  private skipEscape(s: string, start: number): number {
    // OSC: ESC ] ... BEL | ESC \
    if (s[start + 1] === ']') {
      let j = start + 2;
      while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++;
      return Math.min(s.length, j + (s[j] === '\x07' ? 1 : 2)) - start;
    }
    // CSI with unrecognised final byte
    if (s[start + 1] === '[') {
      let j = start + 2;
      while (j < s.length && !/[a-zA-Z@]/.test(s[j])) j++;
      return Math.min(s.length, j + 1) - start;
    }
    return 2;
  }

  private clearAll(): void {
    for (let i = 0; i < this.height; i++) this.screen[i] = [];
  }

  private eraseToEndOfScreen(): void {
    this.eraseLine('toEnd');
    for (let i = this.row + 1; i < this.height; i++) this.screen[i] = [];
  }

  private eraseLine(mode: 'toEnd' | 'all'): void {
    const line = this.screen[this.row] ?? [];
    if (mode === 'all') {
      this.screen[this.row] = [];
      return;
    }
    for (let c = this.col; c < this.width; c++) delete line[c];
    this.screen[this.row] = line;
  }

  /** Visible text of each non-empty row. */
  lines(): string[] {
    return this.screen.map((line) => {
      let out = '';
      for (let c = 0; c < this.width; c++) out += line[c] ?? ' ';
      return out.replace(/\s+$/, '');
    });
  }

  nonEmptyLines(): string[] {
    return this.lines().filter((l) => l.trim().length > 0);
  }

  /** How many rows contain the given substring. */
  countRowsContaining(needle: string): number {
    return this.lines().filter((l) => l.includes(needle)).length;
  }

  /** All text on screen, joined — useful for "does it appear at all" checks. */
  text(): string {
    return this.lines().join('\n');
  }

  /** Rows wider than the terminal — impossible on a real screen, so a signal
   *  that our own accounting thinks a line fits when it does not. */
  overflowingRows(): string[] {
    return this.lines().filter((l) => l.length > this.width);
  }
}
