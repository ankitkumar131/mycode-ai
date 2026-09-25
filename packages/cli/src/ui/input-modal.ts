/**
 * Keyboard ownership for modal UI.
 *
 * The composer attaches `keypress` and `data` listeners to stdin when it starts
 * reading, and only detaches them in `close()`. Those listeners stay live for
 * the whole session, including while a turn is running. Any modal UI that also
 * reads the keyboard - the approval picker, for instance - therefore competes
 * with the composer for every keypress: arrow keys move both, and Enter is
 * delivered to both.
 *
 * That is why "Always allow this command" never seemed to take effect. The
 * picker resolved a value, but the composer was simultaneously consuming the
 * same keystrokes, so the selection the user saw and the value that came back
 * did not match.
 *
 * A modal claims exclusive input for its lifetime; the composer stands down and
 * is restored afterwards. Depth-counted so nested modals behave.
 */

type InputGuard = { suspend: () => void; resume: () => void } | null;

let guard: InputGuard = null;
let depth = 0;

/** Called by the composer so a modal can take the keyboard away from it. */
export function registerInputGuard(next: InputGuard): void {
  guard = next;
}

/** Take exclusive keyboard ownership. Pair every call with `exitModal`. */
export function enterModal(): void {
  depth++;
  if (depth === 1) {
    try {
      guard?.suspend();
    } catch {
      /* a failing guard must not break the modal */
    }
  }
}

/** Give the keyboard back. Safe to call more times than `enterModal`. */
export function exitModal(): void {
  if (depth === 0) return;
  depth--;
  if (depth === 0) {
    try {
      guard?.resume();
    } catch {
      /* same */
    }
  }
}

/** True while a modal owns the keyboard. */
export function isModalActive(): boolean {
  return depth > 0;
}
