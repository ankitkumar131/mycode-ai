# opencode vs MyCode — analysis, plan, and measured results

> **Provenance.** An earlier version of this document lived outside the repository
> and was destroyed when the workspace was reset; no copy survived. Part 5 is
> fresh and exact. Parts 1–4 are a reconstruction, and every claim that could be
> re-checked was re-verified against a fresh clone of `anomalyco/opencode` at
> revision `8bb2ccf` (v1.18.34) and against MyCode at `6adfe22` (v3.2.0).
> Items marked **✓** were verified in that clone; items marked **~** are
> structural observations that were not re-checked this pass.
>
> Where the two disagree, trust the code over this document, and trust a
> measurement over both.

| | opencode `8bb2ccf` v1.18.34 | MyCode `6adfe22` v3.2.0 |
| --- | --- | --- |
| Language / runtime | TypeScript, Bun, Effect | TypeScript, Node ≥ 20 |
| Source files (`.ts`, excl. tests) | ~2,734 total ✓ | 117 ✓ (34 test files) |
| Architecture | client/server, multiple front-ends | single process, one CLI |
| Built-in agents | 7 ✓ | 2 (explore, general) + main |
| Themes | 37 ✓ | 8 ✓ |
| Slash commands | built-ins + markdown-defined | 49 built-ins ✓ + markdown-defined |
| Tool schemas advertised per request | — | 22 (measured) |
| Licence | MIT | MIT |

---

# Part 1 — What opencode is, and how its UI differs

## 1.1 Shape of the product

opencode is not a CLI with features bolted on; it is a **client/server system**
with several front-ends over one engine. ✓ The repository contains `packages/app`
(a desktop application), `packages/tui`, `packages/ui` (a shared theme/component
layer), `packages/cli`, `packages/core`, `packages/opencode`, `packages/schema`
and more, plus an `acp` package — the Agent Client Protocol — so external editors
can drive the same agent.

That split is the single biggest structural difference from MyCode. In opencode,
the thing that runs the agent is a **server** (`packages/opencode/src/cli/cmd/serve.ts` ✓);
the TUI, the desktop app, the web view and an editor integration are all clients
speaking to it. In MyCode, the agent loop and the terminal UI are the same
process, wired directly.

Consequences, in order of how much they matter:

1. **Attachment.** You can attach a second terminal to a running session, or drive
   the same session from an editor, because the session is not owned by the TUI.
2. **Survivability.** A crashed front-end does not kill the agent loop.
3. **Testability.** The engine is exercised over a protocol boundary rather than
   through a terminal.
4. **Cost.** Enormous surface area: state serialization, protocol versioning,
   concurrency control, and a build/test matrix many times larger.

## 1.2 The engine

- **Effect** for typed effects and structured concurrency (**~**). This is the
  reason cancellation, retry and resource cleanup behave uniformly: they are
  library primitives rather than per-call-site code.
- **Drizzle + SQLite** for persistence (**~**): sessions, messages, parts, and
  metadata live in a real database with migrations (`packages/core/src/database/migration/`
  ✓ — migration files are named per feature, e.g. `…_add_context_epoch_agent.ts`).
  Consequences: session search is a query, not a directory scan; a session can be
  resumed after a crash mid-turn; migrations force schema decisions to be explicit.
  MyCode stores sessions as files.
- **A provider layer with per-provider adapters** (**~**), including native
  Anthropic handling (thinking blocks, cache breakpoints) rather than routing
  everything through an OpenAI-shaped shim — which is exactly the gap MyCode
  closed in this branch (`packages/core/src/routing/anthropic-provider.ts`).

## 1.3 The seven agents ✓

Verified by reading `packages/opencode/src/agent/agent.ts`: `build`, `plan`,
`general`, `explore`, `compaction`, `title`, `summary`.

The distinction that matters is not the count, it is that **`compaction`,
`title` and `summary` are agents with their own prompts and models**, not
functions. Summarising a session is a model call with a purpose-built prompt that
can be evaluated and tuned independently. MyCode has compaction as a module
(`packages/core/src/session/compaction.ts`); it now works, but it is not a
first-class agent definition a user can override.

## 1.4 Configuration and customisation surface

- **Markdown-defined commands** (**~**, and the reason MyCode now reads the same
  directories). A file in a command directory becomes a slash command with
  frontmatter metadata.
- **Markdown-defined agents** (**~**): users define their own agents — name,
  description, model, tool allowlist, prompt — in the same way. This is the
  feature MyCode still does not have.
- **Plugins with a documented hook list** (**~**): `packages/core/src/plugin/`
  contains `agent.ts`, `command.ts`, `provider.ts`, `skill.ts`, `host.ts`
  ✓ — i.e. plugins can contribute agents, commands, providers and skills, not just
  observe events. MyCode has skills and MCP; it has no plugin host.
- **Skills** ✓ (`packages/core/src/plugin/skill/`), the same idea MyCode
  implements in `packages/core/src/skills/`.

## 1.5 Terminal and desktop UI

- **37 themes** ✓, as JSON files in `packages/ui/src/theme/themes/` — a shared
  theme layer consumed by every front-end, so the TUI, the desktop app and the
  web view agree. MyCode has 8 themes in `packages/cli/src/ui/themes/registry.ts`,
  with a `Proxy`-frozen token layer so a theme switch cannot leave stale colours.
- **A keybind system** ✓ (`packages/app/src/context/command-keybind.ts`), with
  bindings that are data rather than `if (key.name === …)` chains. MyCode reads
  raw keypresses in `TextArea`.
- **LSP integration** ✓ (`packages/opencode/src/lsp/`): diagnostics after edits,
  which turns "I wrote a file" into "I wrote a file and here is what is wrong with
  it". MyCode verifies after writes by re-running commands; it does not query a
  language server.
- **A PTY** ✓ (`packages/core/src/pty.ts`, plus a node-pty compatibility shim):
  interactive processes behave properly because they are attached to a real
  terminal. MyCode's shell tool is not a PTY.
- **A snapshot/revert layer** ✓ (`packages/core/src/snapshot.ts`). MyCode's
  equivalent is `packages/core/src/git/snapshots.ts` with first-capture-wins
  semantics, which is weaker: it captures before writes rather than keeping a
  session-scoped tree, so reverting a session requires the session to have done
  the capturing.
- **Session forking** (**~**): branch a conversation and try two approaches.
- **Sub-agent child sessions that can be navigated in the UI** ✓ — there is an
  end-to-end regression test literally named
  `subagent-child-navigation.spec.ts`. Watching a sub-agent work is a UI concern
  there, not a logging convention.

## 1.6 Where the UI genuinely differs (summary)

| Dimension | opencode | MyCode |
| --- | --- | --- |
| Front-ends | TUI, desktop, web, editor via ACP ✓ | terminal only |
| Attach to a running session | yes | no |
| Custom agents in markdown | yes | no (skills only) |
| Plugin host (contribute agents/commands/providers) | yes ✓ | no |
| LSP diagnostics | yes ✓ | no (command-based verification instead) |
| PTY shell | yes ✓ | no |
| Themes | 37 ✓ | 8 ✓ |
| Session storage | SQLite + migrations ✓ | files |
| Sub-agent visibility | navigable child sessions ✓ | rendered inline, one level |
| Update/versioning | release channels | npm + version banner |

---

# Part 2 — Why the other one feels better at writing code and running tasks

This is the honest mechanism list. None of it is magic; each item is a way of
either giving the model better information, giving it a cheaper way to get it, or
making it check its own work.

## 2.1 Code writing

1. **Edit formats that match how models write.** Search/replace blocks and diff
   application, not only whole-file writes. A whole-file write forces the model to
   reproduce the entire file correctly, including the parts it never read.
2. **Read-before-write discipline.** The agent reads the region it is about to
   change, so the edit lands on real text.
3. **Post-edit repair.** A failed patch is fed back with the actual file content
   so the next attempt can succeed, instead of failing the turn.
4. **Diagnostics after edit** (LSP ✓) — the cheapest possible verification loop:
   no command to run, no output to parse.
5. **Formatter integration**: writing code that is already formatted removes an
   entire class of follow-up edits.
6. **Multiple edit shapes**: create, overwrite, insert, and multi-file patches in
   one call.
7. **A real `apply_patch`-style tool** that reports per-hunk success.
8. **File freshness checks**: refusing to write over content that changed since
   the read.
9. **Truncated reads with explicit markers**, so the model knows it is looking at
   a window rather than the whole file.
10. **Tool schemas narrow enough to choose well** — 22 schemas is already a lot to
    pick from; the other agent's advantage is not a bigger toolbox.

## 2.2 Command execution

1. **PTY-backed shell** ✓ — interactive tools behave, and programs that detect a
   terminal do not behave differently under the agent than under a human.
2. **Streaming output with incremental capture**, so a long build shows progress
   and can be cancelled.
3. **Cancellation and timeouts as language primitives** (Effect) rather than as
   `setTimeout` + `kill` at each call site.
4. **Background process management**: start a server, keep it alive across turns,
   read its logs later.
5. **Output budgets**: keep the tail and the parts that match error patterns,
   rather than dumping megabytes into context.
6. **Exit-code-aware formatting**: a non-zero exit is presented as failure with
   the failing lines first.
7. **Working-directory and environment control** per call.

MyCode now has: cancellation, timeouts, output truncation, and a
verify-after-write loop (`packages/core/src/verify/verify.ts`). It does not have a
PTY or a persistent background-process manager beyond `processManager`.

## 2.3 Task performance

1. **Plan/todo state that survives compaction** — a task list is the cheapest
   defence against losing the thread.
2. **Sub-agents that do not pollute the parent context.** The measured example
   from this branch: a child explored 5,684 tokens' worth of files and returned a
   46-character report to the parent.
3. **Compaction that summarises rather than truncates**, with the summary written
   by a purpose-built agent.
4. **Session persistence that can resume mid-turn** (SQLite).
5. **Forking** to try two approaches without losing the first.
6. **A permissions model granular enough to be usable**: per-tool, per-path,
   remember-this-decision, rather than one global "yolo" switch.
7. **Provider failover that preserves state**, which is MyCode's differentiator
   and the invariant this work protected.
8. **Model routing per agent**: the cheap model titles the session, the strong
   model writes the code.
9. **Prompt-cache discipline**: stable prefixes and explicit cache breakpoints,
   because cache hits change both cost and latency by an order of magnitude.
10. **Token accounting that is visible**, so a bad tool result is noticed before
    it is paid for repeatedly.

## 2.4 The ranked table (what actually moves the needle)

Ordered by expected effect on task success, not by how impressive it sounds.

| # | Mechanism | Kind | Effect | MyCode status |
| --- | --- | --- | --- | --- |
| 1 | Verify after write | loop | very high | shipped |
| 2 | Sub-agents with context isolation | context | very high | shipped |
| 3 | Compaction that summarises | context | very high | shipped |
| 4 | Native Anthropic path (thinking, caching) | provider | high | shipped |
| 5 | Failover preserving conversation state | reliability | high | shipped (**differentiator**) |
| 6 | Persistent, resumable sessions | state | high | partial (files) |
| 7 | Prompt-cache breakpoints | cost | high | shipped |
| 8 | Todo state surviving compaction | task | high | shipped |
| 9 | Output budgets and truncation | context | medium-high | shipped |
| 10 | Read-before-write + freshness | editing | medium-high | partial |
| 11 | LSP diagnostics | verification | medium-high | missing |
| 12 | PTY shell | execution | medium | missing |
| 13 | Markdown-defined commands | extensibility | medium | **shipped this branch** |
| 14 | Markdown-defined agents | extensibility | medium | missing |
| 15 | Plugin host | extensibility | medium | missing |
| 16 | Session forking | workflow | medium | missing |
| 17 | Snapshot/revert per session | safety | medium | partial |
| 18 | Granular permissions | safety | medium | partial |
| 19 | Background process manager | execution | medium | partial |
| 20 | Desktop/web front-ends | surface | low (for CLI users) | n/a |
| 21 | ACP / editor integration | surface | low | n/a |
| 22 | Markdown-defined skills | extensibility | medium | shipped (pre-existing) |
| 23 | Minimal-code discipline in the prompt | prompt | medium | **shipped this branch** |
| 24 | 37 themes | polish | low | 8 |

---

# Part 3 — The plan MyCode executed (80/20)

Twelve changes, chosen so that the top of the ranked table is covered without
rebuilding the product:

1. Native Anthropic provider with thinking round-trip and cache breakpoints.
2. Checkpointed failover: state is captured *before* a switch is announced.
3. Per-provider capability (`read`/`write`), `max_retries`, explicit context windows.
4. Real sub-agents with iteration budgets and write tools stripped.
5. Post-write verification loop with a bounded retry.
6. Compaction that summarises instead of truncating.
7. Todo store that survives compaction; output store with truncation and re-read.
8. MCP client and tool bridge.
9. Git snapshots with first-capture-wins revert.
10. Theme registry, status line, diff pager, sub-agent rendering.
11. Dependency diet: unused runtimes removed (`ink`, `react`, `node-pty`, …).
12. Reproducible smoke tests (`npm run smoke:*`), hermetic, no API key.

**Not chosen, deliberately:** desktop/web front-ends, ACP, plugin host, LSP.
They are real, but each is a project rather than a change, and none of them
raises the ceiling on a single task's success rate the way items 1–7 do.

**§9.8 of the original plan — the eval harness — was the unbuilt remainder, and is
now built.** See Part 5.

---

# Part 4 — What shipped, and how it was verified

All of the following were run before the branch was pushed; each line is a
command that can be re-run.

```
npx tsc --noEmit           clean
npm run build              6/6 packages
npm test                   34 files / 369 passed     (baseline: 19 files / 152)
npm run lint               0 errors, 199 warnings
npm run smoke:failover     8/8, hermetic, no API key
npm run eval:selftest      20 tasks: every seed fails, every solution passes
npm run eval -- --dry-run  20/20 through the full pipeline
```

Item-by-item, against the plan:

| Plan item | Where | Evidence |
| --- | --- | --- |
| Anthropic provider | `core/routing/anthropic-provider.ts` | `/v1/messages`, `anthropic-version 2023-06-01`, thinking budget `min(4096, maxTokens−1024)`, cache breakpoints on last tool + system + 4-turn tail, `tool`→`user` + `tool_result` collapsing, signature round-trip; unit tests |
| Checkpointed failover | `core/routing/failover.ts` | `observe()` checkpoints before announcing; `effectiveWindowFor` = explicit → caller table → hints → 128k; name-based reason strings; hermetic 8/8 smoke |
| Sub-agents | `core/agents/subagent.ts` | explore 20 / general 40 iterations, write tools stripped; measured 5,684 child tokens → 46-char report |
| Verification loop | `core/verify/verify.ts` | re-runs the project's own command after a write, bounded retries |
| Compaction | `core/session/compaction.ts` | summarising, not truncating; tested |
| Todo + output stores | `core/tools/todo-store.ts`, `output-store.ts` | plan survives compaction; large outputs truncated and re-readable |
| MCP | `core/mcp/mcp-client.ts`, `mcp/tool-bridge.ts` | `registerMCPTools` → `{servers, tools, failed}`, `server__tool`, non-throwing |
| Snapshots | `core/git/snapshots.ts` | first-capture-wins; restore deletes agent-created files |
| CLI surface | `cli/src/ui/*` | 8 themes with frozen tokens, todo panel, status line, diff pager |
| Dependency diet | `package.json` | `ink`, `react`, `ink-*`, `node-pty`, `@xterm/headless`, `highlight.js`, `lowlight`, `tinygradient`, `cli-spinners`, `@google/genai` removed after confirming no imports |
| Smoke tests | `scripts/*.mjs` | `npm run smoke:*`, hermetic |

---

# Part 5 — The eval harness, and the defects it was built alongside

Two things were asked for: numbers instead of assertions, and a fix for a
reported Windows defect. Both are done.

## 5.1 The reported defect, and its actual cause

The report: on Windows PowerShell the status line was reprinted **once per typed
character** — typing `what all` produced exactly eight copies — and the banner
offered `3.1.1 → 3.1.2`.

Cause, established by reproduction rather than inspection: the composer redraws
by moving the cursor up (`ESC [ n A`), erasing (`ESC [ J`) and rewriting the
region. That is only meaningful if the host console processes ANSI cursor
sequences. A bare `cmd.exe` or Windows PowerShell does not, so the erase is inert
and each keystroke appends. There was **no terminal-capability detection anywhere
in the CLI** — only `isTTY` checks.

The reproduction is pinned as a test: with ANSI disabled, the status line
duplicates, which is the reported symptom; with ANSI enabled it does not.

The fix:

- `packages/cli/src/ui/capabilities.ts` decides cursor-control support from
  TTY-ness, `TERM`, `TERM_PROGRAM`, and the Windows host markers (`WT_SESSION`,
  `ConEmuANSI`, `ANSICON`). Windows consoles are presumed incapable unless a
  known-good host is detected. `MYCODE_FORCE_CURSOR` / `MYCODE_NO_CURSOR` override
  either way, and colour is detected separately (`NO_COLOR` / `FORCE_COLOR`).
- `TextArea.read()` degrades to the line-based reader when cursor control is
  unavailable, instead of corrupting the screen.
- `chat.ts` omits the live status line in that mode and prints one plain status
  line per turn, so nothing is lost.
- `mycode doctor` reports the whole detection result.

The version complaint was legitimate: the published package was 3.1.2 while the
repository said 3.1.1. Everything is now 3.2.0, and the update notice is
suppressed when running from a git working copy, because a checkout is never
something you update from npm.

## 5.2 The harness

`evals/` — 20 tasks, a recording proxy, adapters for MyCode and opencode, and a
report. The design decisions that make it worth trusting:

- **Measured at the wire.** Both agents are pointed at a local proxy that forwards
  to the real provider and records every request. Token counts, request counts,
  latency and the model string come from the same place for every agent, instead
  of from each agent's own accounting — which would compare two different
  definitions. It also catches the case where two agents are running different
  models under the same name.
- **Verifiers that require work.** Every task's `verify.sh` runs from the original
  task directory (editing the in-workspace copy cannot help), checks behaviour
  rather than shape (`sliceLast([1,2,3,4], 0)` must return `[]`, not the whole
  list), and several forbid weakening the test file.
- **A self-test for the suite.** `npm run eval:selftest` enforces both halves:
  every seed must fail (or the task scores for free) and every reference solution
  must pass (or no agent can score). It found four defects in the suite while it
  was being written — a task whose only bug was `-0`, a task whose seed already
  passed, a task whose reference solution still failed, and a TypeScript check
  that needed the network.
- **A dry-run path.** `--dry-run` runs a reference-solution agent through
  workspaces, proxy, verifiers and report, so the pipeline is checkable with no
  API key and no dependency on another agent's installation.

## 5.3 What it measures

| Metric | Why it is in the report |
| --- | --- |
| Tasks solved | The only number that matters; the task's own verifier decides |
| Median time to solve | Successful runs only — a fast failure is not speed |
| LLM requests | The agent loop's round-trip efficiency |
| Prompt / completion tokens | Measured at the proxy; cached tokens counted separately |
| **Fixed overhead** | First request's prompt tokens = system prompt + tool schemas + task. What every session pays before doing anything |
| **Tool schemas advertised** | How much of that overhead is the toolbox |
| Peak context | The largest single request — the real ceiling in practice |
| Tokens per solved task | Punishes burning context and still failing |
| Provider errors, timeouts | Distinguishes "wrong" from "broken" |
| Tool calls | Best-effort from the agent's own log; not comparable across agents, and labelled as such |

## 5.4 First measured result

Run against a mock upstream through the recording proxy, so the numbers are wire
facts rather than self-reports:

```
MyCode, one trivial turn:
  requests                2
  prompt tokens           7,198 → 7,327   (grows with conversation)
  completion tokens       50
  tool schemas advertised 22
  fixed overhead          ~7.2k prompt tokens before doing any work
```

That 7.2k is the number the harness exists to make visible. It is the price of
the toolbox and the system prompt on every single session, and it is now on the
record for whatever agent is being measured, in the same units.

The head-to-head against opencode requires a real API key and an installed
opencode, because a comparison between an agent and a mock is not a comparison:

```sh
EVAL_API_KEY=sk-... EVAL_UPSTREAM=https://api.openai.com/v1 \
  npm run eval -- --model gpt-4o --agents mycode,opencode --runs 3
npm run eval:report
```

## 5.5 Parity items closed this pass

- **User-defined slash commands from markdown** — `.mycode/commands/*.md`, and
  deliberately also `.opencode/command/` and `.claude/commands/`, so a repository
  already set up for another agent works unchanged. `$ARGUMENTS`, `$@`, `$1`..`$9`
  expansion; project commands shadow user commands; untypeable names rejected.
  Verified end to end against an echo provider — the model receives the
  substituted prompt, not the template.
- **`mycode run "..."`** alias for the one-shot path, matching the subcommand
  other agents expose.
- **`/allow-all` — stop being asked, for this session only.** `/allow-all` bypasses
  both writes and shell commands until the process exits; `/allow-all writes` or
  `/allow-all commands` scope it; `/allow-all off` puts the prompts back;
  `/allow-all status` reports the state. `--allow-all` is the startup equivalent
  of `--yolo`, and `mycode agent --allow-all` applies to autonomous runs.

  Three decisions make it safe to have:
  1. **Nothing is persisted.** It is process state, never written to
     `settings.json`, so a decision taken in a hurry is not silently inherited by
     the next run. Exiting restores the normal approval mode.
  2. **The catastrophic floor stays.** `BLOCKED_PATTERNS` in `command-safety.ts`
     (`rm -rf /`, `mkfs`, `dd` to a raw device, `chown -R`, `halt`/`reboot`) still
     refuses to run. "Don't interrupt me" is not the same instruction as "format
     my disk", and a bypass reachable by a mis-typed prompt is how machines are
     lost. The command says so when it arms.
  3. **It is always visible.** The badge leads both status surfaces
     (`⚡ ALLOW-ALL` in the composer line and in the turn summary), and it is
     placed first specifically so width truncation cannot hide it. `/status`
     reports it too.

  Both approval gates — agent tool calls and `!cmd` shell runs — now go through a
  single `shouldPrompt()` decision, so the two paths cannot drift apart. 23 unit
  tests cover the truth table; end-to-end, the confirmation box appears without
  `/allow-all` and disappears with it, and reappears after `/allow-all off`.

  **Discoverability, from a real report of "I don't want to be asked".** The
  bypass was only reachable if you already knew the command, so it is now
  offerable from the prompt itself — the confirmation picker gains
  *"Always allow all <scope> for this session"*, placed exactly where the
  annoyance happens. Two more changes come from the same report:

  - The banner names the way out when approvals are on:
    `Approvals on for file writes and commands — run /allow-all …`, printed once
    at startup instead of never.
  - The banner reports a **build identity** (`build: 0933787 · built <time>`).
    "Am I running the build that has that fix?" is otherwise unanswerable, and a
    stale global install looks identical to a bug that was never fixed. This was
    prompted by exactly that confusion.

  **A pasted block was inserted twice, and each character cost a repaint.**
  Reported as *"if something I paste it pastes 2 times and becomes messy."*
  Two separate defects, both reproduced in tests before being fixed:

  - The composer has two listeners on stdin. Its own `data` handler is
    *prepended* so it consumes a bracketed paste first — but readline's own
    `data` listener still runs afterwards on the same chunk and emits a
    `keypress` for every character in it. The guard that suppresses those is
    `pasteMode`, which the data handler cleared *synchronously*, so by the time
    the keypresses fired the guard was already false and the whole paste was
    inserted a second time. A paste split across chunks duplicated its later
    chunks, which is why longer pastes looked mangled rather than merely
    doubled. The clear is now deferred to the next tick, which keeps the guard
    true for exactly the events produced by that chunk.
  - Every keystroke triggered a full erase-and-repaint. On a terminal without
    bracketed paste the block arrives as individual characters, so a 200-char
    paste meant 200 full repaints — slow, flickering, and messy. Edits are now
    coalesced within a tick: the same 200 characters cost at most three
    repaints, with the first edit still immediate.

  Eight tests cover it, including a multi-line paste, a paste split across
  chunks, a burst with no bracketed-paste support, and a large paste that
  collapses to a placeholder while still submitting every line.

  **The provider announcement was logged per request, not per switch.** Because
  the agent loop issues one request per iteration, a long turn printed
  `✦ Using <provider>` dozens of times — visible as a wall of identical lines in
  the reported session. It now announces only when the serving provider changes,
  so a switch (including a failover) still announces and a stable session stays
  quiet.

## 5.6 Ponytail: the minimal-code rules, on by default

Requested: *"integrate this from default and will be used automatically from start
in each query asked."* Source: <https://github.com/DietrichGebert/ponytail>
(MIT, © 2026 DietrichGebert, v4.10.0) — *"the laziest senior dev in the room."*
It ships as plugins and rules packs for a dozen agents; there is no library to
install, so the behaviour was vendored into the source tree as a real module
rather than imported or documented. The MIT text and the exact list of
adaptations are in `NOTICE.md`.

**What it does.** Before answering, the model works down a seven-rung ladder:
*(1)* does this need to exist at all, *(2)* does it already exist in this
codebase, *(3)* does the standard library do it, *(4)* does a native platform
feature cover it, *(5)* does an already-installed dependency solve it, *(6)* can
it be one line, and only then *(7)* write the minimum code that works. Bug fixes
are root-cause fixes — grep every caller, fix the shared function once. Deletion
beats addition, and the shortest working diff wins. A deliberate corner cut is
marked with a `ponytail:` comment naming its ceiling and upgrade path, so the
cheap choice is honest instead of invisible.

**The list of things that are never simplified away** is carried verbatim in the
prompt, because "minimum code" without it is just an excuse: understanding the
problem first, input validation at trust boundaries, error handling that
prevents data loss, security, accessibility, hardware calibration, explicitly
requested work, and one runnable check behind any non-trivial logic.

**Levels and resolution.** `lite` / `full` / `ultra`, with `full` the default.
Resolution order is `PONYTAIL_DEFAULT_MODE` → config file → `full`, matching
upstream: `~/.config/ponytail/config.json` with XDG honoured, or
`%APPDATA%\ponytail\config.json` on Windows, key `defaultMode`. An invalid
value in either place — a typo — is ignored, not propagated; a typo must never
silently switch the rules off. The runtime mode is process-local and never
persisted, again matching upstream.

**How it is wired.**

| Surface | Behaviour |
|---|---|
| System prompt | The section is inserted ahead of the Working rules on every query, unless the mode is `off` or a caller passes `ponytail: false`. No trigger, no install step. |
| `/ponytail` | Bare form prints the level, where it came from, and the level guide; `/ponytail lite|full|ultra|off` switches. The switch re-runs `refreshSystemPrompt()`, so it applies to the **next query** in the same session. |
| `/ponytail-review [target]` | Reviews the target against the ladder. |
| `/ponytail-audit [path]` | Audits a path for over-build: abstractions nobody asked for, dependencies that duplicate the stdlib, boilerplate with no caller. |
| `/ponytail-debt` | Lists the deliberate corner cuts — every `ponytail:` marker with its ceiling. |
| `/ponytail-gain` | Renders upstream's published medians as ASCII bars: lines of code 6–20% of no-skill, cost 23–53%, 3–6× faster. **Those are upstream's benchmark numbers, not this repository's**, and the command says so on screen. |
| `/ponytail-help` | The ladder and the never-simplify list. |
| Plain language | A message that is *entirely* "stop ponytail", "ponytail off", "normal mode", "no ponytail" switches it off; "ponytail on", "ponytail mode", "be lazy", "lazy mode" switches it to `full`. Matched on the whole trimmed message only, so an incidental "normal mode" mid-sentence never changes behaviour. |
| Startup banner | `🐴 ponytail: full (default) — /ponytail off to disable`, and nothing at all when it is off. Same reasoning as the approvals line: a behaviour the user cannot see is a behaviour they cannot trust, and an off switch they cannot find is not much of a switch. |
| `/status` | A `Rules` row, so the current mode is inspectable mid-session. |

**Verified by execution, not by reading the diff.** A recording provider logged
whether the ladder and its provenance reached the model:

| Run | Result |
|---|---|
| Fresh session, nothing configured | Request **#1** carries the ladder — `full`, 7 760 chars of system prompt; 3 857 without it |
| `PONYTAIL_DEFAULT_MODE=off` | Gone from request #1 |
| `defaultMode: "lite"` in the config | Present, intensity `lite` |
| `/ponytail ultra` mid-session | Next request carries `ultra` |
| `/ponytail off` mid-session | Next request carries nothing (req 11 has the ladder, req 12 does not) |
| `normal mode` typed as a whole message | Gone from the next request |

26 unit tests cover parsing, the env→config→default resolution, invalid values,
XDG and Windows paths, session-override precedence, rung ordering in the section
text, the never-simplify list, per-level intensity, and the null-when-off case.
Three more cover the banner. Two real bugs were caught by those tests before
they shipped: the config file was not read when the caller supplied an
environment whose home differed from the ambient one, and the status line
reported `(from config)` in every case, including the plain default.

## 5.7 What is still behind, in order

1. **Markdown-defined agents.** Commands are done; agents are not. This is the
   next real extensibility item.
2. **A per-turn interrupt/limit story.** The reported session ended with
   *"Step limit reached"*; the limit is announced after the fact rather than
   approached visibly, and the user cannot extend it mid-turn.
3. **LSP diagnostics.** Verification currently means running a command; a language
   server would make it free.
4. **Persistent, resumable sessions.** File storage means a crash loses the turn.
5. **PTY shell** and a background process manager.
6. **Plugin host** — letting third parties contribute agents, commands and
   providers rather than only consume them.
7. **Session forking.**
8. **A wider theme set.** 8 against 37 is a polish gap, not a capability gap.

Each of these is now measurable rather than arguable: the harness reports what a
change did to solve rate, tokens, and fixed overhead, on the same tasks, with the
same verifier, at the same wire.

---

# Part 6 — The gap list, re-verified against opencode's current `dev`

> **Provenance.** Written 2026-10-08. opencode was read at `anomalyco/opencode@dev`,
> HEAD `5d9cd9b` (docs tree at `663fbd7`); the feature surface below is the set of
> pages opencode publishes in `packages/web/src/content/docs/*.mdx` plus the README —
> i.e. every item on this list is something opencode *documents as a feature*, not
> something inferred from a file name. MyCode was read at `da3ab4a` (v3.2.1) by
> grep/read of the code, with "0 hits" meaning `grep -rniE <pattern> packages/{core,cli}/src`.
> Where a claim is a count, the count was measured. Nothing here is carried over
> from Parts 1–5 on trust.
>
> opencode's docs pages, mapped: `acp` `agents` `cli` `commands` `config`
> `custom-tools` `ecosystem` `enterprise` `formatters` `github` `gitlab` `go` `ide`
> `keybinds` `lsp` `mcp-servers` `models` `network` `permissions` `plugins`
> `policies` `providers` `references` `rules` `sdk` `server` `share` `skills`
> `themes` `tools` `troubleshooting` `tui` `web` `windows-wsl` `zen`.

## 6.1 Hard gaps — opencode ships it, MyCode has no implementation

| # | Capability | opencode evidence | MyCode evidence |
| --- | --- | --- | --- |
| 1 | **Plugin host** — third-party TS/JS plugins on documented hooks, can contribute tools, auth and transforms | `docs/plugins.mdx`, `packages/core/src/plugin/*` | `grep -rni plugin` → 2 hits, both comments. No loader, no hook bus. |
| 2 | **On-disk custom tools** — a file in a tool directory becomes a tool | `docs/custom-tools.mdx` | 0 hits. `registerTool()` exists, but only in-process via the SDK. |
| 3 | **Markdown-defined agents** — user agents with own model, prompt, tool allowlist; switchable | `docs/agents.mdx` | 0 hits for `.mycode/agents`. Commands and skills are markdown; agents are not. |
| 4 | **LSP diagnostics** — language server errors after an edit, no command to run | `docs/lsp.mdx`, `packages/opencode/src/lsp/` | 0 hits for lsp/language-server. Verification re-runs the project's own command. |
| 5 | **PTY shell** | `docs/tools.mdx`, `packages/core/src/pty.ts` | 0 hits for pty/node-pty. `exec-command.ts` uses `child_process`. |
| 6 | **Session forking / branching** | `docs/tui.mdx`, `session.fork` | 0 hits. There is `/undo` (snapshots) but no branch-a-conversation. |
| 7 | **Navigable sub-agent child sessions** | regression test `subagent-child-navigation.spec.ts` | Sub-agents render inline; there is no child session to open. |
| 8 | **Server / headless mode with an HTTP API** (plus mDNS discovery) | `docs/server.mdx`, `docs/network.mdx` | 0 hits for `createServer`/`listen(`. Nothing in the process listens on a socket. |
| 9 | **ACP — editor/agent protocol** so Zed et al. can drive the agent | `docs/acp.mdx` | 0 hits for acp. |
| 10 | **IDE integration** (VS Code / Cursor / Zed config, auto-install) | `docs/ide.mdx`, `sdks/vscode` | 0 hits. No extension, no config writer. |
| 11 | **Session sharing via links** | `docs/share.mdx` | 0 hits (the 13 grep hits are `sharedStrings.xml` in the xlsx reader — unrelated). |
| 12 | **GitHub integration** — run the agent from issues/PRs via a GitHub Action | `docs/github.mdx`, `github/` package | 0 hits. |
| 13 | **GitLab integration** | `docs/gitlab.mdx` | 0 hits. |
| 14 | **Desktop application** (beta, all platforms) | README, `packages/app` | none. |
| 15 | **Web UI** (`opencode web`) | `docs/web.mdx` | none. |
| 16 | **Configurable keybinds** | `docs/keybinds.mdx` | 1 incidental hit. `TextArea` reads raw keypresses; nothing is rebindable. |
| 17 | **Custom themes + 37 built-ins** | `docs/themes.mdx`, JSON theme files | 8 built-ins, no custom-theme loading (`registry.ts`). |
| 18 | **SQLite persistence with migrations** — sessions, parts, resume after a crash mid-turn | `docs/config.mdx`, `packages/core/src/database/migration/` | Sessions are JSON files (`sessions/session-store.ts`); a crash loses the in-flight turn. |
| 19 | **Per-agent model routing** — the cheap model titles, the strong one codes | `docs/agents.mdx` (`model` per agent) | One model per session; compaction and sub-agents use the current provider, not a chosen model. |
| 20 | **`@agent` mentions in a message** (`@general …`) | `docs/agents.mdx` | 0 hits. Delegation is the model's decision via the `delegate` tool. |
| 21 | **Structured outputs** (JSON-schema-constrained responses in the SDK) | `docs/sdk.mdx` | not implemented; the SDK returns text. |
| 22 | **Installer matrix** — curl installer, Homebrew, Scoop/Chocolatey, pacman/AUR, mise, nix | README | npm only (`@ankitkumar131/mycode-ai`). |
| 23 | **Translations** — 20+ READMEs, docs set per language | README, `docs/<lang>/` | English only. |
| 24 | **Agent roster beyond subagents** — `build`/`plan` switchable at runtime, plus `scout`, and title/summary/compaction as first-class agents | `docs/agents.mdx` (2026-05: "add scout agent") | 2 sub-agents (`explore`, `general`) + the main loop; compaction is a module, not an agent. |

## 6.2 Partial — the shape exists, the capability does not

| # | Capability | What MyCode has | What is missing |
| --- | --- | --- | --- |
| 25 | **Permissions** | `confirmWrites` / `confirmCommands`, session allow-all (`/allow-all`, or the in-prompt option) scoped to writes/commands, catastrophic floor in `command-safety.ts` | No per-tool allow/ask/deny, no path/glob rules, no directory-level config layering (`docs/permissions.mdx`, `docs/policies.mdx`). It is two switches, not a policy. |
| 26 | **Plan mode** | `/plan` writes a plan to `.mycode/plans/`; the `explore` sub-agent is read-only by construction | No read-only *primary* agent the user can switch to and back mid-session. |
| 27 | **Background processes** | `process-manager.ts`: `background: true`, log polling, stdin writes, kill | No PTY (see #5). This is otherwise shipped, not partial. |
| 28 | **Persistence** | `SessionStore` with list/search/load/latestFor, `/compress`, `--continue` | File-per-session, no DB, no mid-turn crash resume (#18). |
| 29 | **Verification** | formatter + diagnostics after a write, bounded retries (`verify/verify.ts`) | Command-based only; no LSP (#4). |
| 30 | **SDK** | `@mycode/sdk` — `MyCodeAgent`, events, `registerTool`, `registerProvider`, fail-closed approvals; publishable (`.d.ts`, external core) | Unpublished; not generated from a server API (there is no server, #8), so it cannot drive a running session the way opencode's SDK does. |

## 6.3 Closed since Parts 1–5 — do not re-report these as gaps

| Item | Evidence |
| --- | --- |
| SDK had "no `registerTool`/`registerProvider`" (Part 5 §10) | Both exist on `MyCodeAgent`; core gained a provider-factory registry. Publishable (`npm pack`: 490 kB/18 kB), still deliberately unpublished. |
| Session approval bypass outlived its session | Fixed: `/new`, `/clear`, `/allow-all off` restore prompts; regression test drives the real TUI loop. |
| "Background process manager (partial)" | Verified shipped: `ProcessManager` spawns detached, keeps logs, accepts stdin. |
| Markdown commands, `mycode run`, `/allow-all`, AGENTS.md | All shipped and covered by tests (`custom-commands.ts`, `mycode.ts`, `session-approvals.ts`, `system-prompt.ts`). |
| Failover, native Anthropic, sub-agents, compaction, todo/output stores, MCP, snapshots, 22 tools | Shipped — MyCode's side of the ranked table in Part 2.4 is unchanged and still ahead on failover. |

## 6.4 Commercial surfaces — parity is not the goal

`docs/zen.mdx` and `docs/go.mdx` document opencode's own hosted model gateway and
subscription plan; `docs/enterprise.mdx` covers SSO/SAML, audit logs and policy
management. There is no equivalent in MyCode and none is planned: these are
business surfaces, not agent capabilities, and they are the only part of the
"gap list" that costs money rather than engineering time.

## 6.5 If only three of these get built

Ranked by effect on a single task, using the same reasoning as Part 2.4:

1. **LSP diagnostics (#4).** Turns post-write verification from "run the project's
   command and parse it" into "ask the language server", which is cheaper, faster
   and already running in the user's editor.
2. **Markdown-defined agents (#3) + per-agent model routing (#19).** Together they
   are the extensibility story users ask for first, and they reuse the markdown
   loader that already exists for commands.
3. **MCP is the stable extension point today**, which is why the plugin host (#1)
   and on-disk tools (#2) rank below these two: MCP already covers "contribute
   tools from outside the process", and it is the interface MyCode does not have
   to invent.

Deliberately not in the top three, despite being large: the server (#8) and the
front-ends (#14, #15) are projects, not changes; each becomes worth doing only
once something that is not a terminal needs to attach.
