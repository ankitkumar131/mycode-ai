/**
 * OpenTUI launcher stub — Phase 1.
 *
 * Legacy UI remains the default. This stub only checks prerequisites and
 * falls back with guidance, so `mycode chat --tui=opentui` never breaks.
 *
 * Full implementation needs: Bun >=1.3.14, Node >=26.4, `@opentui/core/solid/keymap`
 * + Zig natives + `jsx:preserve` + `bunfig.toml` preload. See `plan_opencode.md`.
 */

export type TuiKind = 'legacy' | 'opentui';

export function parseTuiFlag(value: string | undefined): TuiKind {
  return value === 'opentui' ? 'opentui' : 'legacy';
}

export function nodeSupportsOpenTUI(version = process.version): boolean {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) && major >= 26;
}

export function hasBun(): boolean {
  return !!(process as unknown as { versions?: { bun?: string } }).versions?.bun;
}

/**
 * Attempt to launch the OpenTUI shell.
 * @returns true if OpenTUI took over, false if caller should use legacy UI.
 */
export async function tryLaunchOpenTUI(): Promise<boolean> {
  if (!nodeSupportsOpenTUI()) {
    console.log(
      `  OpenTUI needs Node >=26.4 (current: ${process.version}). Using legacy UI. See plan_opencode.md Phase 1.`,
    );
    return false;
  }
  try {
    // @ts-ignore - optional peer, installed in Phase 0 (plan_opencode.md)
    await import('@opentui/core');
    // @ts-ignore - optional peer, installed in Phase 0 (plan_opencode.md)
    await import('@opentui/solid');
  } catch {
    console.log(
      '  OpenTUI packages not installed yet (@opentui/core, @opentui/solid, solid-js). Using legacy UI. See plan_opencode.md Phase 0.',
    );
    return false;
  }
  console.log('  OpenTUI shell not yet implemented (Phase 2). Using legacy UI.');
  return false;
}
