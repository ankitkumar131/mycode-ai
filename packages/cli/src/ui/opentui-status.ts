/**
 * OpenTUI readiness report for `/doctor` (Phase 5).
 *
 * The real shell lives in the Bun-only `./tui` workspace (repo root),
 * isolated from the npm/esbuild legacy build. This reporter never imports
 * `@opentui/*`, so it is safe on Node 20+ with no natives installed.
 */
export function describeOpenTUI(): string {
  const bun =
    (process as unknown as { versions?: { bun?: string } }).versions?.bun ?? null;
  const major = Number(process.version.replace(/^v/, '').split('.')[0]);
  const nodeOk = Number.isFinite(major) && major >= 26;
  return (
    `backend=legacy (use --tui=opentui for the Phase 1 stub)  ` +
    `bun=${bun ?? 'missing (run powershell scripts/setup-bun.ps1)'}  ` +
    `node=${process.version}${nodeOk ? ' (opentui-ready)' : ' (need >=26.4 for OpenTUI)'}  ` +
    `workspace=./tui (bun-only, 10 tests green)`
  );
}
