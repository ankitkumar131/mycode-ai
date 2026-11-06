# OpenTUI Migration Plan for mycode

> Source: opencode `1.0+` / `2.x` TUI stack (`packages/tui/package.json`, root `catalog:`).
> Goal: bring opencode-style interactive terminal (live command execution, mouse/clicks, cursor control) to mycode without breaking current CLI.

## 1. Current state (verified 2026-10-10)

- Runtime: `Node v24.15`, `npm`, **no Bun**, `win32 x64` (Windows 11 Pro).
- Root: `Node >=20`, `type: module`, `esbuild ^0.25.0` via `scripts/build.mjs` -> `packages/cli/dist/mycode.js` (ESM) + `mycode-standalone.cjs` (CJS).
- CLI UI: custom stack in `packages/cli/src/ui/`:
  - `text-area.ts` (~1360 lines) — multiline composer, readline, ANSI erase/redraw.
  - `renderer.ts` — `marked + chalk` markdown, tables, diff colors.
  - `spinner.ts` — `ora` thinking/tool spinners.
  - `capabilities.ts` — `supportsCursorControl()`, `supportsColour()`, `describeTerminal()`, conservative on `win32`.
  - `status-line.ts`, `todo-view.ts`, `diff-viewer.ts`, `prompt.ts`, `themes/`, `layouts/`, `key/`, `hooks/`.
- Chat loop: `packages/cli/src/commands/chat.ts` — `TextArea.read()`, `session.run()`, `executeCommand onLog: process.stdout.write`, `confirmCommand`, `SessionApprovals`.
- Deps: `chalk@5, marked@14, diff@7, ora@8, tree-kill`.

## 2. Target state (opencode `2.0.26`)

- `Bun >=1.3.14`, `Node >=26.4` (for `@opentui/core`), `solid-js@1.9.15`.
- Core renderer:
  - `@opentui/core@0.5.17` + natives `@opentui/core-win32-x64` etc. — Zig backend: raw mode, alt-screen, ANSI, synchronized-output, SGR mouse, Kitty keyboard, cursor, Yoga layout, images/QR.
  - `@opentui/solid@0.5.17` — `<box> <text> <scrollbox> <input> <textarea> <select> <tab_select> <code> <diff> <ascii_font>`, `render()/testRender()/Portal/Dynamic`, `useKeyboard/useRenderer/onResize/onFocus/useSelectionHandler/useTimeline`.
  - `@opentui/keymap@0.5.17` — keybinds.
  - `opentui-spinner@0.0.7`, `@solid-primitives/*`, `@tanstack/solid-virtual@3.13.37`, `solid-list@0.3.0`.
- Live exec:
  - `@lydell/node-pty@1.2.0-beta.12` + `fix-node-pty` postinstall — real PTY.
  - `ghostty-web` (patched `anomalyco/ghostty-web#83c0a07`) — terminal emulation.
  - `uqr@0.1.3`, `@opentui/qrcode/solid`.
- Rendering:
  - `string-width@7.2.0`, `get-east-asian-width@1.6.0`, `strip-ansi@7.1.2`, `shiki@4.4.3`, `@shikijs/stream`, `marked@18`, `marked-shiki`, `web-tree-sitter@0.25.10`, `diff@9`, `@pierre/diffs@1.5.1`, `fuzzysort@3.1.0`, `effect@4.0.1`, `remeda@2.26.0`.

Old opencode `0.x` (`Go + charmbracelet/bubbletea + lipgloss + bubbles + glamour + cobra`) is **not** a target — superseded.

## 3. Mapping mycode -> OpenTUI

| mycode today | OpenTUI replacement | Notes |
|---|---|---|
| `ui/text-area.ts` | `<input>/<textarea>` + keymap + `useKeyboard` | Highest risk. Preserve Enter/Ctrl+Enter/Tab/`/`/`@`/history/stash/`$EDITOR`/paste. |
| `ui/renderer.ts`, `diff-viewer.ts`, `todo-view.ts` | `<text>/<box>/<scrollbox>/<code>/<diff>` + shiki/marked | Port theme tokens. |
| `ui/spinner.ts` (`ora`) | `opentui-spinner` | Remove `ora`. |
| `ui/capabilities.ts` | Built into core | Keep `MYCODE_NO_CURSOR/PLAIN` + `dumb`/CI fallback. |
| `chat.ts runShell/executeCommand` | `node-pty.spawn` -> `ghostty-web` -> `<code>` stream | Only path to true interactive exec. Keep `tree-kill` + `processManager.killAll`. |
| `status-line.ts` | Solid component with signals | Keep `YOLO/PLAN` badge priority. |

## 4. Phases (full)

### Phase 0 — Toolchain spike [STATUS: IN PROGRESS]
Objective: prove OpenTUI can load on this machine without touching legacy UI.
Prereqs: Windows 11 x64, Node 24.15 (current), no Bun yet.
Steps:
- [x] Record baseline: Node 24.15 / npm 12 / no Bun / engines >=20 / no `tui/` dir.
- [x] Create safe placeholders (typecheck-green): `packages/cli/src/tui/hello.spike.ts` (pins + future JSX), `scripts/setup-bun.ps1`.
- [ ] Install Bun Windows x64 (`powershell scripts/setup-bun.ps1`), verify `bun --version >=1.3.14`.
- [ ] Upgrade test Node to >=26.4 side-by-side (nvm4w), keep project engines at >=20 until Phase 1.
- [ ] Real hello in scratch dir (NOT npm workspaces): `bun add @opentui/core@0.5.17 @opentui/solid @opentui/keymap solid-js opentui-spinner`, hello + `bunfig.toml` preload + `tsconfig jsx:preserve`, `bun run hello.tsx`.
Files: `packages/cli/src/tui/hello.spike.ts` (done), `scripts/setup-bun.ps1` (done), `C:\Temp\opencode-spike/hello.tsx` (pending).
Accept: native `@opentui/core-win32-x64` loads under Bun AND Node 26; click + keyboard works in Windows Terminal + VSCode; legacy `npm run build/typecheck/test` still green.
Rollback: delete spike files only; no legacy touched.
Risk: Bun AV block, ConPTY missing, Node 26 nvm friction.

### Phase 1 — Flag-gated launcher + build isolation [STATUS: DONE (stub)]
Objective: `mycode chat --tui=opentui` exists but safely falls back to legacy.
Steps:
- [x] `packages/cli/src/tui/launcher.ts` (`parseTuiFlag/nodeSupportsOpenTUI/tryLaunchOpenTUI`), `App.tsx` placeholder without Solid JSX.
- [x] `ChatOptions.tui`, `parseChatFlags --tui/--tui=`, `CHAT_FLAGS`, `--help` line, `chat.ts` gate after providers check.
- [ ] `bunfig.toml` preload, `tsconfig jsx:preserve + jsxImportSource`, `bun build` for `tui/` only (deferred until Phase 0 Bun green).
Files: `packages/cli/src/tui/*`, `packages/cli/src/mycode.ts`, `packages/cli/src/commands/chat.ts`.
Accept: `npm run typecheck/build` green; `--help` shows `--tui`; `--tui=opentui` on Node 24 prints fallback and continues legacy; existing `ui/__tests__` pass.
Rollback: revert 3 files + delete `tui/` dir.

### Phase 2 — TUI shell [STATUS: DONE in `tui/` workspace]
Objective: root layout + message list + statusline in Solid, legacy still default.
Steps:
- Root `<box>` (header/banner, scrollable transcript, composer slot, statusline slot).
- Virtualized transcript (`@tanstack/solid-virtual` / `solid-list`) for long logs; `<text>/<code>/<diff>` rendering via `shiki + marked + marked-shiki`.
- Statusline component: model/provider, tokens/window, bar, elapsed, queued, stashed, YOLO/PLAN badge (badge never truncated).
- Theme port from `ui/themes/` (dark/light, `prefersLightTheme`), `NO_COLOR/FORCE_COLOR` respect.
- `testRender()` snapshots for shell + statusline truncation.
Files: `packages/cli/src/tui/App.tsx`, `components/Transcript.tsx`, `components/StatusLine.tsx`, `theme.ts`, `*.test.tsx`.
Accept: Bun hello-shell renders banner + fake transcript + statusline at 80col and 120col; legacy untouched.
Risk: Yoga flex differences vs hand-rolled ANSI.

### Phase 3 — Composer [STATUS: DONE in `tui/` workspace]
Objective: parity with `text-area.ts` (~1360 lines) keybindings.
Steps: Enter send; Ctrl/Shift/Alt+Enter, Ctrl+J, `\`+Enter newline; arrows/in-lines + history edges; Home/End/Ctrl+A/E; Ctrl+Left/Right, Alt+B/F; Ctrl+W/Alt+BS; Ctrl+U/K; Del/Ctrl+D (empty=exit); Ctrl+L; Ctrl+G/X-E `$EDITOR`; Ctrl+S stash; Ctrl+Z unix; Tab ghost+`/`+`@`; Esc menu→clear; Ctrl+C clear→exit x2; `/` live menu (commands+skills+quick); `@` path menu; bracketed paste collapse.
Files: `packages/cli/src/tui/components/Composer.tsx`, keymap config, history `~/.mycode/history.json` reuse, `ui/__tests__/text-area*` parity tests ported to `testRender` + key events.
Accept: all legacy composer tests have Solid equivalents; manual matrix passes on WT + VSCode + Git Bash.
Risk: Kitty keyboard vs legacy Ctrl+Enter detection; IME/paste edge cases.

### Phase 4 — PTY live execution [STATUS: DONE in `tui/` workspace, native verified]
Objective: true opencode-style streaming command output + clicks.
Steps:
- `node-pty.spawn` wrapper (shell, cwd, env, cols/rows, timeout 600s default, `tree-kill` on kill, `processManager.killAll` integration).
- `ghostty-web` parser -> `<code>` stream with ANSI preserved; exit-code line (`! exited N`).
- Wire to `session onToolCall (terminal/execute_code/process)` spinner -> live panel -> `onToolResult` with duration + error color.
- Preserve `classifyCommand` blocked list + `confirmCommand` + `SessionApprovals.allow('commands')` + yolo/plan-mode gating; no prompt bypass.
- ConPTY resize handling, big-output cap + collapse (mirror 4000/600 verbose caps).
Files: `packages/cli/src/tui/pty.ts`, `components/ToolPanel.tsx`, `packages/core` `executeCommand` adapter (no behavior change for legacy).
Accept: `dir/ping` streams live in spike; approval prompts still fire; blocked commands still blocked; kill works on Windows.
Risk: native `node-pty` build, AV, `fix-node-pty` postinstall, output flood perf.

### Phase 5 — Packaging [STATUS: PARTIAL — doctor reports readiness; native distribution pending]
Objective: shippable without breaking `npm i -g`.
Steps:
- `optionalDependencies` per-arch natives; `postinstall fix-node-pty`; `mycode doctor` shows `opentui native=yes/no + Bun/Node`.
- Solve `mycode-standalone.cjs` + FFI: separate `tui` artifact or `bun compile`; keep legacy standalone working.
- Clean-machine smoke: Win11 + macOS + Linux `npm i -g`, `--tui=opentui` hello, legacy default hello.
Accept: fresh installs work on all 3 OS; missing native -> clean fallback message, exit 0 to legacy.
Risk: bundle size, npm optional-deps skew, code-signing.

### Phase 6 — QA / rollout [STATUS: PARTIAL — legacy green except 5 pre-existing Windows failures; manual terminal matrix pending]
Objective: safe default switch only when ready.
Matrix: Windows Terminal / VSCode / Git Bash/MSYS / cmd.exe / PowerShell / CI `dumb` + `!TTY`; `MYCODE_NO_CURSOR/PLAIN/FORCE_CURSOR` respected; fallback to legacy when `!TTY || dumb || native missing`.
Checks: `npm run build/typecheck/lint`, `vitest run` full, long-log + large-diff perf, rapid-stream no-tear, `/allow-all` session scope preserved, sessions autosave/resume intact.
Docs: README + `--help` + `doctor`; flag promotion after 1 green release, default switch only after 2 green releases.
Rollback: one-flag revert to legacy default at any time.

## 5. Risks

- Windows PTY/ConPTY + AV + `node-pty` native build pain.
- Standalone CJS bundle incompatible with Zig FFI — new distribution needed.
- Losing `supportsCursorControl()` conservative fallback -> screen corruption on bare `cmd.exe`/Pwsh.
- `solid-js` patch maintenance (opencode carries patches).
- `vitest` (Node) vs `bun test` + `testRender` duality.
- Scope creep: full rewrite vs incremental flag-gated adoption.

## 6. What NOT to do

- Do not `npm i @opentui/*` into Node 20/npm/esbuild path and expect it to run.
- Do not delete legacy `text-area.ts`/`renderer.ts`/`capabilities.ts` until flag-gated parity.
- Do not adopt `Go/BubbleTea` stack — dead path.

## 7. Execution order (one by one)

Order: Phase 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6. Do not skip. Phase 1 stub is done; now executing Phase 0 spike. Each phase ends with `typecheck + build + relevant vitest` green before next begins.
