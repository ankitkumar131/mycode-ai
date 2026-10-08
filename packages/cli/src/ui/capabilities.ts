/**
 * Terminal capability detection.
 *
 * The composer redraws by moving the cursor (`ESC [ n A`), erasing
 * (`ESC [ J`) and re-drawing. That only works if the host console actually
 * processes those sequences. On a console where VT processing is off — bare
 * `cmd.exe`, plain Windows PowerShell, some IDE task runners, CI log views —
 * the sequences are printed as inert text, the erase does nothing, and every
 * keystroke appends another copy of the status line and input.
 *
 * So the decision whether to use cursor control has to be made up front rather
 * than assumed. When it is unavailable we fall back to a plain, line-based
 * composer: far less pretty, but it never corrupts the screen.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: boolean | null = null;

/** Explicit opt-out, for terminals we misdetect or users who prefer plain output. */
function explicitlyDisabled(): boolean {
  const v = process.env.MYCODE_NO_CURSOR ?? process.env.MYCODE_PLAIN;
  return v === '1' || v?.toLowerCase() === 'true';
}

/** Explicit opt-in, for exotic-but-capable hosts. */
function explicitlyEnabled(): boolean {
  const v = process.env.MYCODE_FORCE_CURSOR;
  return v === '1' || v?.toLowerCase() === 'true';
}

/**
 * True when the terminal reliably honours ANSI cursor movement.
 *
 * Deliberately conservative on Windows: an interactive console there may or may
 * not have VT processing enabled, and getting it wrong produces screen
 * corruption rather than a cosmetic problem. Hosts that are known to enable it
 * are accepted explicitly.
 */
export function supportsCursorControl(): boolean {
  if (cached !== null) return cached;

  if (explicitlyDisabled()) {
    cached = false;
    return cached;
  }
  if (explicitlyEnabled()) {
    cached = true;
    return cached;
  }

  // Without a TTY there is no screen to position a cursor on.
  if (!process.stdout.isTTY) {
    cached = false;
    return cached;
  }

  const term = process.env.TERM ?? '';
  if (term === 'dumb') {
    cached = false;
    return cached;
  }

  if (process.platform === 'win32') {
    // These hosts enable VT processing for their children without us asking.
    const program = process.env.TERM_PROGRAM ?? '';
    const known =
      !!process.env.WT_SESSION || // Windows Terminal
      !!process.env.ConEmuANSI || // ConEmu / Cmder
      !!process.env.ANSICON || // ANSICON shim
      /vscode|hyper|alacritty|wezterm|mintty|windows terminal/i.test(program) ||
      /xterm|cygwin|msys/i.test(term); // Git Bash / MSYS / Cygwin

    if (known) {
      cached = true;
      return cached;
    }

    // A bare console host (cmd.exe, Windows PowerShell). Windows 10+ can be
    // switched on, but we cannot detect that from here, so assume not.
    cached = false;
    return cached;
  }

  // Everywhere else, a TTY that is not `dumb` handles cursor control.
  cached = true;
  return cached;
}

/** Colour is independent of cursor control; NO_COLOR is a separate convention. */
export function supportsColour(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return !!process.stdout.isTTY || process.env.TERM === 'xterm-256color';
}

/** A short description for `/doctor`. */
export function describeTerminal(): string {
  const bits = [
    `platform=${process.platform}`,
    `TERM=${process.env.TERM ?? '(unset)'}`,
    `TERM_PROGRAM=${process.env.TERM_PROGRAM ?? '(unset)'}`,
    `stdout.isTTY=${!!process.stdout.isTTY}`,
    `stdin.isTTY=${!!process.stdin.isTTY}`,
    `cursor=${supportsCursorControl() ? 'yes' : 'no'}`,
    `colour=${supportsColour() ? 'yes' : 'no'}`,
  ];
  if (process.env.WT_SESSION) bits.push('WT_SESSION=yes');
  return bits.join('  ');
}

/** Test seam: forget the cached detection. */
export function resetCapabilityCache(): void {
  cached = null;
}

/**
 * Short identity for the running build: `<commit>` or `<commit> · built <time>`.
 *
 * Only meaningful for a source checkout, where the commit is recoverable.
 * Returns null for an installed package, because there the version number is
 * the identity.
 *
 * The point is diagnosability: "am I running the build that has that fix?" is
 * otherwise unanswerable, and a stale global install looks exactly like a bug
 * that was never fixed.
 */
/** Read the build timestamp scripts/build.mjs leaves beside the CLI bundle. */
function readBuildStamp(here: string): number {
  for (const candidate of [join(here, 'BUILD_STAMP'), join(here, '..', 'BUILD_STAMP')]) {
    try {
      if (existsSync(candidate)) {
        const n = Number(readFileSync(candidate, 'utf-8').trim());
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* ignore */
    }
  }
  return 0;
}

export function describeBuild(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, '.git'))) {
        const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf-8').trim();
        let commit = head;
        if (head.startsWith('ref:')) {
          const ref = head.slice(5).trim();
          const refFile = join(dir, '.git', ref);
          if (existsSync(refFile)) {
            commit = readFileSync(refFile, 'utf-8').trim();
          } else {
            const packed = join(dir, '.git', 'packed-refs');
            if (existsSync(packed)) {
              const line = readFileSync(packed, 'utf-8')
                .split('\n')
                .find((l) => l.endsWith(` ${ref}`));
              if (line) commit = line.split(' ')[0];
            }
          }
        }
        const short = commit.slice(0, 7);
        const builtAt = Number(process.env.MYCODE_BUILD_TIME ?? 0) || readBuildStamp(here);
        if (builtAt) {
          return `${short} · built ${new Date(builtAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
        }
        return short;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}
