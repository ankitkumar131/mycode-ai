/**
 * Phase 0 spike descriptor — Bun-only hello, NOT part of the npm build.
 *
 * This file intentionally contains NO Solid JSX so `npm run typecheck`
 * (`jsx: react-jsx`) and `scripts/build.mjs` (esbuild) keep passing.
 * The real spike lives outside npm workspaces until Bun + Node 26 verify green.
 *
 * Pinned versions (from opencode 2.0.26 catalog):
 *   @opentui/core@0.5.17, @opentui/solid@0.5.17, @opentui/keymap@0.5.17,
 *   solid-js@1.9.15, opentui-spinner@0.0.7,
 *   @lydell/node-pty@1.2.0-beta.12, string-width@7.2.0, strip-ansi@7.1.2,
 *   fuzzysort@3.1.0, shiki@4.4.3
 *
 * To run the real spike (needs Bun >=1.3.14):
 *   1. `powershell scripts/setup-bun.ps1`
 *   2. `mkdir C:\Temp\opencode-spike; cd C:\Temp\opencode-spike`
 *   3. `bun add @opentui/core@0.5.17 @opentui/solid @opentui/keymap solid-js opentui-spinner`
 *   4. Create `hello.tsx` with the FUTURE_JSX below (uncommented), plus
 *      `bunfig.toml` containing: preload = ["@opentui/solid/preload"]
 *      and `tsconfig.json` with `jsx: preserve`, `jsxImportSource: @opentui/solid`.
 *   5. `bun run hello.tsx` — expect bordered Hello + mouse click + key logging
 *      in Windows Terminal and VSCode terminal.
 *
 * Acceptance (plan_opencode.md Phase 0): native win32-x64 loads under Bun AND
 * Node 26; legacy `npm run build/typecheck/test` stays green.
 */

export const SPIKE_VERSION_PINS = {
  '@opentui/core': '0.5.17',
  '@opentui/solid': '0.5.17',
  '@opentui/keymap': '0.5.17',
  'solid-js': '1.9.15',
  'opentui-spinner': '0.0.7',
  '@lydell/node-pty': '1.2.0-beta.12',
  'string-width': '7.2.0',
  'strip-ansi': '7.1.2',
  fuzzysort: '3.1.0',
  shiki: '4.4.3',
} as const;

// Future Bun-only hello (do NOT uncomment here — legacy tsc would fail):
// import { render, useKeyboard } from '@opentui/solid';
// function Hello() {
//   useKeyboard((key) => { if (key.name === 'q') process.exit(0); });
//   return (<box border><text>Hello mycode + OpenTUI (click me, press q)</text></box>);
// }
// render(() => <Hello />);

export const FUTURE_JSX = `<box border><text>Hello mycode + OpenTUI (click me, press q)</text></box>`;

export const PHASE0_BASELINE = {
  node: 'v24.15.0',
  bun: null as string | null,
  engines: '>=20.0.0',
  date: '2026-10-10',
};
