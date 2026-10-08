# Dead code & cruft audit

**Branch:** `arena/546d4550-mycode-ai` (base `backup_latest_arena/01a0f6a5-mycode-ai` = `8a8606c`) · **v3.2.1** · **Date:** 2026-10-08

Everything below was found by inspection **and then tested**: I copied the repo, deleted the tier-1 items in the copy, and re-ran the full pipeline there.

## Baseline (before any change)

| Check | Result |
|:---|:---|
| Tracked files | **696** (24,403,183 bytes ≈ 24.4 MB) |
| `npm run typecheck` | clean |
| `npx vitest run` | **445/445 pass**, 40 files |
| `npm run lint` | **211 warnings, 0 errors** — 177 `no-explicit-any`, 34 `no-unused-vars`, across **47 files** |
| `npm run format:check` | **fails — 115 files** would be reformatted |
| `node scripts/smoke-failover.mjs` | 8/8 checks pass |

## Result of deleting the tier-1 list (verified in a copy at `/tmp/deadcheck`)

| Check | Before | After pruning | Verdict |
|:---|:---|:---|:---|
| Tracked files | 696 | **580** (−116) | — |
| Tracked bytes | 24.4 MB | **17.9 MB** (−6.49 MB, **−26.6 %**) | — |
| `tsc --noEmit` | clean | **clean** | ✅ nothing dangling |
| `node scripts/build.mjs` | ok | **ok** (6 packages → 3) | ✅ |
| `npx vitest run` | 445/445 | **445/445** | ✅ no test depended on it |
| `mycode --version` / `doctor` | ok | **ok** | ✅ CLI unaffected |
| `smoke-failover.mjs` | 8/8 | **8/8** | ✅ failover unaffected |
| `npm run lint` | 211 | **198** (−13) | ✅ |

---

## 1. Safe to delete — unreferenced, verified (116 files, 6.49 MB)

### 1.1 Legacy pre-monorepo implementation — `src/` + `tests/` (39 files, 208 KB)

The whole original implementation, superseded by `packages/core/src`. Proof it is unreachable:

- `bin/mycode.js` loads `packages/cli/dist/*`; nothing in the repo imports `src/` (the only references anywhere are inside `graphify-out/graph.json`, a stale generated index).
- `vitest.config.ts` collects only `packages/*/src/**/*.test.ts` → **`npx vitest list` picks up 0 files from `tests/`**.
- `tsconfig.json` / `eslint.config.js` only include `packages/*/src`, and eslint ignores `**/*.js`, so these 39 files are never even linted.
- `package.json` has no `main`, no `files` entry, and no script that touches them.

| Path | Files | Bytes | Why it's dead |
|:---|--:|--:|:---|
| `src/` (agent, commands, providers, tools, ui, utils) | 34 | 192,035 | duplicate of `packages/core/src` + `packages/cli/src` (JS, pre-monorepo) |
| `tests/*.test.js` (5 files) | 5 | 16,140 | never collected by vitest; superseded by in-package `.test.ts` suites |

### 1.2 Stub / unused packages (13 files)

| Path | Files | Bytes | Why it's dead |
|:---|--:|--:|:---|
| `packages/a2a-server/` | 5 | 1,242 | `A2AServer.start()`/`stop()` are empty; nothing imports it; no `bin`; unpublished |
| `packages/devtools/` | 3 | 628 | exports one string constant (`DEVTOOLS_VERSION`); zero importers |
| `packages/test-utils/` | 5 | 1,129 | `createMockProvider` / `createMockAgentSession` are imported by **0 of the 40 test files** |

### 1.3 Dead CLI entry point (2 files + built output)

| Path | Bytes | Why it's dead |
|:---|--:|:---|
| `packages/cli/src/index.ts` | 145 | exports `MyCodeApp` from the stub below; **nothing imports `@mycode/cli`** |
| `packages/cli/src/ui/App.ts` | 61 | `class MyCodeApp { async start(): Promise<void> {} }` — empty |

Cost: the build emits `packages/cli/dist/index.js` (+ 400 KB map) from this entry, and **both are shipped in the npm tarball** for an entry no one imports. Removal needs a one-line build guard (§2.1).

### 1.4 Orphan CLI modules — 0 importers each (4 files, 10.4 KB)

| Path | Bytes | Notes |
|:---|--:|:---|
| `packages/cli/src/ui/command-output-renderer.ts` | 4,191 | "Gemini CLI-style" output box; `createCommandOutput`/`printCompactResult` referenced nowhere. Superseded by the inline rendering in `commands/chat.ts` + `ui/renderer.ts` |
| `packages/cli/src/ui/slash-picker.ts` | 3,323 | interactive `/` picker; chat implements completion inline in `slash-commands.ts` |
| `packages/cli/src/ui/skill-picker.ts` | 1,053 | unused, **and** it breaks the package boundary: `import { skillManager } from '../../../core/src/skills/skill-manager.js'` (the only cross-package relative import in the repo — would not resolve outside this checkout) |
| `packages/cli/src/ui/web-client.ts` | 1,871 | stub for the roadmap web dashboard; `renderWebClientHTML` never called |

### 1.5 Dead core "API surface" — exported by `index.ts`, consumed by nobody (12 files, 17 KB)

Each of these is imported **only** by `packages/core/src/index.ts` (or by another module in this list). Zero uses in `packages/cli`, `packages/sdk`, or any test:

| Path | Bytes | What it is |
|:---|--:|:---|
| `packages/core/src/voice/voice-engine.ts` | 642 | `VoiceEngine.transcribe()` — nothing calls it |
| `packages/core/src/context/context-manager.ts` | 414 | both methods are no-ops (`getSystemContext()` → `''`, `resolveReferences()` → input unchanged) |
| `packages/core/src/context/file-resolver.ts` | 186 | only used by the no-op above |
| `packages/core/src/policy/policy-engine.ts` | 329 | 15-line stub; `checkPermission()` result unused |
| `packages/core/src/policy/permission-manager.ts` | 8,888 | 353 lines of real logic whose only consumer is the dead `agents/` API below |
| `packages/core/src/hooks/hooks.ts` + `types.ts` | 757 | `HookAggregator`/`HookRunner` — no hook is ever registered or fired |
| `packages/core/src/output/output-formatter.ts` + `types.ts` | 527 | trivial wrappers (`formatText` returns its input) |
| `packages/core/src/agents/agent-service.ts` | 521 | registry nothing registers into or reads |
| `packages/core/src/agents/built-in.ts` | 3,619 | `registerBuiltInAgents(...)` never called |
| `packages/core/src/agents/types.ts` | 896 | types for the two files above |

`packages/core/src/agents/subagent.ts` is **not** in this list — it is genuinely used (`delegate` tool).

### 1.6 Committed build artefacts & outputs (42 files, 6.18 MB)

| Path | Files | Bytes | Why it shouldn't be in git |
|:---|--:|--:|:---|
| `graphify-out/` | 24 | 3,241,199 | generated by the `/graphify` skill: `graph.json` (1.6 MB), `graph.html` (1.4 MB), `manifest.json`, `cache/` (stat-index + hashes). It indexes the **legacy `src/`** files, i.e. it is already stale. The skill regenerates it |
| `brag-output/` | 18 | 2,940,560 | rendered output of the `/brag` skill (composition + 2.7 MB duplicate MP3) — an artefact, not source |

Neither is in `.gitignore` today. Note the brag skill keeps a *second* copy of the same MP3s under `.agents/skills/brag/assets/music/` (see §6).

### 1.7 Orphan docs (4 files, 65.7 KB)

Not linked from `README.md`, `NOTICE.md`, `docs/`, `scripts/` or the site's docs page:

| Path | Bytes | What it is | Suggestion |
|:---|--:|:---|:---|
| `implementation_plan.md` | 15,959 | planning doc from the initial build ("should we support MYCODE.md?") | delete or move to `docs/history/` |
| `report.txt` | 10,359 | early status report, `.txt` at repo root | delete |
| `walkthrough.md` | 6,291 | demo script from the initial build | delete |
| `docs/opencode-vs-mycode.md` | 33,145 | the opencode comparison (its own content is good: it honestly documents missing plugins/LSP/ACP) | keep, but link it from the README — it is currently the only file in `docs/` |

---

## 2. Dead but coupled — needs a small edit alongside the deletion

### 2.1 `packages/cli/src/index.ts` → requires a build guard

`scripts/build.mjs` hard-codes `src/index.ts` as an entry point **for every package**. Deleting the CLI's index without patching the script fails the build (reproduced):

```
✘ [ERROR] Could not resolve "/tmp/deadcheck/packages/cli/src/index.ts"
  ✖ @mycode/cli build failed
```

Fix (verified working): only build `dist/index.js` when the file exists, and drop `main`/`types`/`files` from `packages/cli/package.json`.

```js
const indexEntry = join(pkgDir, 'src', 'index.ts');
if (existsSync(indexEntry)) { /* esbuild build */ }
```

### 2.2 `packages/core/src/agent/event-translator.ts` — dead in effect, referenced by a test mock

- The class is 7 lines: `translate(event) { return JSON.stringify(event) }`.
- Its **only** call site throws the result away — `AgentSession.emit()` calls `this.translator.translate(event)` inside a `try {} catch {}` and ignores the return value.
- Its only other reference is `vi.mock('./event-translator.js', …)` in `agent-session.test.ts:35`. Deleting just the module while leaving the mock + call site fails **11 tests** (verified).

Remove as a set: the module, `emit()` (or make it an empty hook), the import/field/constructor line, and the test mock.

### 2.3 `permission-manager.ts` (8.9 KB)

Deleting it requires also removing `agents/types.ts`'s `RulesetArray` import and the three `index.ts` export lines (lines 170-171). Done in the verified experiment — build, types and tests stayed green.

---

## 3. Unused exports inside files that are otherwise used

69 exported symbols have no reference outside their own file. Most are harmless public types, but these are **functions/constants that nothing calls**:

| File | Dead export |
|:---|:---|
| `packages/cli/src/ui/banner.ts` | `renderUpdateNotice` |
| `packages/cli/src/ui/spinner.ts` | `createCodegenSpinner`, `showProviderSwitch` |
| `packages/cli/src/ui/themes/theme.ts` | `chatStatusBar` |
| `packages/cli/src/ui/todo-view.ts` | `bindTodoPanel`, `printTodoPanel` (only `renderTodoPanel` is used) |
| `packages/cli/src/commands/slash-commands.ts` | `getCompletions`, `findCommand` (completion is done inline elsewhere) |
| `packages/core/src/verify/verify.ts` | `hasDependency` |
| `packages/core/src/skills/skill-loader.ts` | `currentPlatformName` |
| `packages/core/src/tools/command-safety.ts` | `BLOCKED_PATTERNS` (exported, never imported) |
| `packages/core/src/tools/definitions/read-file.ts` | `formatLineNumbered` (self-recursive only) |
| `packages/core/src/documents/document-reader.ts` | `decodeXmlEntities` (internal helper made public) |
| `packages/core/src/mcp/tool-bridge.ts` | `mcpToolToModule` (re-exported via `export *` in `index.ts` — public API with no consumer) |

Plus ~40 unused exported **types/interfaces** (`AgentCommandOptions`, `DiffFile`, `StatusLineState`, `ExecutorOptions`, `SyscallOptions`, …). They cost nothing at runtime — keep if you want a stable SDK surface, prune if you don't.

---

## 4. Lint issues (211 warnings, 0 errors)

**Rule breakdown:** `no-explicit-any` ×177 (mostly in `routing/`, `tools/definitions/`, `mcp/` — `catch (err: any)` and provider payloads), `no-unused-vars` ×34.

The 21 files with `no-unused-vars` — the ones that indicate leftover code:

| File | Unused |
|:---|:---|
| `packages/cli/src/commands/chat.ts` | `renderStatusLine`, `estimateCost`, `renderDiff`, `openDiffViewer`, `diffStats`, `describeTerminal`, `strictSpinnerStop`, `out`, `activeSubAgents` (9!) |
| `packages/cli/src/commands/agent.ts` | `renderStatusLine`, `estimateCost` |
| `packages/cli/src/ui/renderer.ts` | `indent` |
| `packages/cli/src/ui/themes/theme.ts` | `getThemeName` |
| `packages/cli/src/ui/skill-picker.ts` | `readline`, `heavyDivider`, `frame` *(file is dead — §1.4)* |
| `packages/core/src/safety/safety-checker.ts` | `command`, `path` (function args) |
| `packages/core/src/tools/file-detector.ts` | `readFileSync` |
| `packages/core/src/tools/definitions/read-file.ts` | `MAX_BYTES_DEFAULT` |
| `packages/core/src/tools/command-executor.ts` | `target` |
| `packages/core/src/hooks/hooks.ts`, `policy-engine.ts`, `voice-engine.ts`, `built-in.ts`, `permission-manager.ts`, `a2a-server/src/server.ts` | *all dead files — §1.2/§1.5* |
| tests: `text-area-paste`, `text-area-redraw`, `text-area`, `provider-router`, `agent-session`, `sdk` | leftover imports (`beforeEach`, `vi`, `readline`, `AgentOptions`, `Agent`, `previousTerm`) |

Deleting §1.2/§1.4/§1.5 automatically removes **13** of the 211 warnings (198 remain). The other 198 need code changes; the 21 unused-vars in the remaining files are quick wins.

**Formatting:** `npm run format:check` currently fails on **115 files** — the repo has never been Prettier-formatted even though `format`/`format:check` scripts exist. `npm run format` fixes it in one commit (expect a large diff; do it separately from any logic change).

**Lint coverage gaps:** `eslint.config.js` ignores `**/*.js`, `**/*.mjs`, `**/*.cjs`, and both eslint and prettier only look at `packages/*/src`. So `scripts/*.mjs` (7 files), `bin/mycode.js`, `evals/**` and the legacy `src/`+`tests/` are never checked.

---

## 5. Dependencies, packaging & metadata

| Item | Problem | Evidence |
|:---|:---|:---|
| `@mycode/sdk` in `packages/cli/package.json` | declared dependency, **never imported** by the CLI | `grep -rn "@mycode/sdk" packages/cli/src` → 0 |
| `rimraf` (root devDependency) | unused — `scripts/clean.mjs` uses `fs.rmSync` | no import anywhere |
| root `files` list | ships `packages/{core,sdk,a2a-server,devtools,test-utils}/dist` + `scripts/` + `cli/dist/index.js` — **33 MB of the 46 MB unpacked tarball is never executed** | see below |
| `packages/sdk/dist` | 32 MB (12.2 MB bundle + 19.1 MB map) shipped; nothing imports `@mycode/sdk` | `du -sh` on the extracted tarball |
| `types: "./dist/index.d.ts"` in all 6 packages | **no `.d.ts` is ever emitted** — the build is esbuild-only and `tsc` runs `--noEmit`. Every package advertises types that don't exist | `ls packages/*/dist/*.d.ts` → none |
| `vitest.config.ts` coverage block | sets `provider: 'v8'` but `@vitest/coverage-v8` is not a devDependency → `vitest run --coverage` fails | `ls node_modules/@vitest/` |
| `repository` / `homepage` / `bugs` in `package.json` | point at **`anomalyco/mycode`** — a different repo from `ankitkumar131/mycode-ai` | lines 57-63 |
| `scripts/sync-graphify-skill.mjs` | maintenance script not wired to any npm script (manual `node scripts/sync-graphify-skill.mjs`) | `package.json` scripts |
| `.npmignore` | lists `src/`, `node_modules/`, `*.test.ts`… but the root `files` whitelist already decides the tarball → redundant (harmless) | npm semantics |
| `packages/cli/dist/BUILD_STAMP` | build timestamp shipped in the tarball | tarball listing |

**Publishing proof:** installing the published tarball into a clean directory works (`mycode --version` → `3.2.1`) — but only via `bin/mycode.js` → `packages/cli/dist/mycode-standalone.cjs`. The other shipped entry fails:

```
$ node node_modules/@ankitkumar131/mycode-ai/packages/cli/dist/mycode.js --version
Error: Cannot find package '.../@mycode/core/dist/index.js'   (ERR_MODULE_NOT_FOUND)
```

So a publishable `files` list is: `bin`, `packages/cli/dist/mycode-standalone.cjs`, `README.md`, `LICENSE` — everything else is inert (~33 MB saved, tarball 8.5 MB → ~2 MB).

---

## 6. Keep — but worth a decision

| Path | Why it's easy to mistake for cruft | Verdict |
|:---|:---|:---|
| `evals/` (129 files, 400 KB) | looks like scratch data | **keep** — wired to `npm run eval|eval:dry|eval:report|eval:selftest`; tasks/solutions are the fixtures |
| `packages/sdk/` | nothing imports it, `private: true` | **decide** — it is a documented product surface. Either wire it into the CLI, publish it, or drop it + its 32 MB dist (§5) |
| `scripts/mock-provider.mjs`, `mock-failover-provider.mjs`, `smoke-failover.mjs` | test servers | keep — used by `npm run smoke:*` |
| `project-image.jpg` (104 KB) | binary at repo root | keep — embedded in `README.md` |
| `NOTICE.md`, `LICENSE` | — | keep — licence compliance (vendored Ponytail, MIT) |
| `.mycode/MYCODE.md` | looks like a stray fixture | keep — dogfooded project context |
| `.agents/skills/brag/` (288 files, **16.5 MB**) | a workspace skill with its own audio assets | keep the skill (discovered from `<cwd>/.agents/skills`), but the 17 MB of MP3/SFX is the single biggest blob in git. Consider Git LFS or fetch-on-demand; `brag-output/` (§1.6) is a duplicate of part of it and should not be committed |
| `docs/opencode-vs-mycode.md` | not linked from the README | keep + add a link (its content is the honest "what's missing" list) |

---

## 7. Recommended order of work

```bash
# 1. Generated artefacts out of git (no code impact)
printf 'graphify-out/\nbrag-output/\n' >> .gitignore
git rm -r --cached graphify-out brag-output && git commit -m "chore: stop tracking generated skill output"

# 2. Legacy tree (39 files, 208 KB, never built/tested/linted)
git rm -r src tests

# 3. Dead packages + dead CLI entry (patch build.mjs first — §2.1)
git rm -r packages/a2a-server packages/devtools packages/test-utils \
          packages/cli/src/index.ts packages/cli/src/ui/App.ts
# also: drop them from package.json "workspaces"/"files" and scripts/build.mjs lists

# 4. Orphan UI modules
git rm packages/cli/src/ui/{command-output-renderer,slash-picker,skill-picker,web-client}.ts

# 5. Dead core API surface (strip the matching export lines from packages/core/src/index.ts)
git rm -r packages/core/src/hooks packages/core/src/voice
git rm packages/core/src/context/{context-manager,file-resolver}.ts \
       packages/core/src/policy/{policy-engine,permission-manager}.ts \
       packages/core/src/output/{output-formatter,types}.ts \
       packages/core/src/agents/{agent-service,built-in,types}.ts

# 6. Orphan docs
git rm implementation_plan.md report.txt walkthrough.md

# 7. Deps + metadata (package.json fixes, drop @mycode/sdk + rimraf, fix repo URLs,
#    add a declaration build or drop the "types" fields) then:
npm run format      # fixes the 115 unformatted files
npm run lint        # 198 → fewer as the unused-vars are cleaned

# Verify after each step
npm run typecheck && npx vitest run && node scripts/build.mjs && node scripts/smoke-failover.mjs
```

I verified steps 2-5 together in a scratch copy: **typecheck clean, build ok, 445/445 tests, smoke 8/8**.

## What I intentionally did not touch

- No file was deleted or modified in this repository — this is a report only.
- `packages/core/src/agent/event-translator.ts` (§2.2), `permission-manager.ts` (§2.3) and `cli/src/index.ts` (§2.1) are dead but coupled; they are listed with the edit they require instead of in the safe list.
- `packages/sdk/` and `.agents/skills/brag/assets/` are judgement calls, not dead code — listed in §6.

<details>
<summary>Evidence commands</summary>

```bash
# baseline
npm install && npm run typecheck && npx vitest run && npm run lint && npm run format:check
git ls-files | wc -l && git ls-files -z | xargs -0 cat | wc -c     # 696 files / 24,403,183 bytes

# unreachable legacy tree
grep -rn "src/agent/loop" --include=*.ts packages bin scripts     # nothing
npx vitest list | grep -c "^tests/"                               # 0

# orphans (module imported by nobody)
for f in $(find packages -name '*.ts'); do grep -rn "from '.*/$(basename ${f%.ts}).js'" packages; done
# → command-output-renderer, skill-picker, slash-picker, web-client

# dead API surface (imported only by index.ts)
grep -rn "HookAggregator\|PolicyEngine\|OutputFormatter\|VoiceEngine\|ContextManager\|FileResolver\|AgentService\|PermissionManager" \
     packages/cli/src packages/sdk/src                              # 0 hits each

# publishing reality check
npm pack @ankitkumar131/mycode-ai@3.2.1 && tar -tzf *.tgz            # 33 MB unused of 46 MB
cd /tmp/instcheck && npm i <tarball> && ./node_modules/.bin/mycode --version   # works (standalone)
node node_modules/@ankitkumar131/mycode-ai/packages/cli/dist/mycode.js --version  # ERR_MODULE_NOT_FOUND

# the deletion experiment (scratch copy)
tar --exclude=.git --exclude=node_modules -cf - . | (cd /tmp/deadcheck && tar -xf -)
python3 /tmp/prune.py            # deletes tier-1 list + patches core/index.ts + build.mjs
cd /tmp/deadcheck && npx tsc --noEmit && node scripts/build.mjs && npx vitest run
# → typecheck clean · build ok · 445/445 passed · smoke-failover 8/8 · lint 211→198
```
</details>
