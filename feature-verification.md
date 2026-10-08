# Feature verification — 7 claims checked against the code

**Branch:** `arena/546d4550-mycode-ai`
**Base:** `backup_latest_arena/01a0f6a5-mycode-ai` = `8a8606cfb003d7115d29cd9db52574154a792999` (the branch tip — verified with `git ls-remote`)
**Version under test:** 3.2.1 · **Node:** v22.22.3
**Date:** 2026-10-08

## Verdict at a glance

| # | Claim | Verdict | One-line summary |
|:--|:---|:---|:---|
| 1 | All 9 CLI commands | 🟡 **8 of 9** | `review` does not exist as a CLI command — only `/review` inside chat |
| 2 | Any AI provider + auto failover | ✅ **Yes** | 5 provider families + priority failover with checkpointing, proven 8/8 by the smoke test |
| 3 | Autonomous agent mode (8 tools) | ✅ **Yes** / ⚠️ **count wrong** | Agent loop is real; it ships **22** tools, not 8, and the listed `search_code` doesn't exist |
| 4 | MYCODE.md project context | ✅ **Yes** | Verified at runtime — file content lands in the system prompt |
| 5 | SDK, plugins & custom providers | 🟡 **Partial** | Custom providers ✅, SDK package exists but its documented API doesn't; **no plugin host at all** |
| 6 | A2A protocol server | ❌ **No** | Empty stub class, no HTTP listener, not reachable from the CLI |
| 7 | Standalone binary builds | 🟡 **Partial** | Self-contained 12.7 MB JS bundle ✅; no SEA/native executable ❌ (still needs Node) |

**Tally: 2 fully present · 4 partial · 1 absent.**

## How this was checked

Static inspection was not trusted on its own — the repo was installed, built and exercised:

```bash
npm install                        # 250 packages, ok
npm run build                      # ok — all 6 packages + cli standalone bundle
npx vitest run                     # 40 files, 445/445 tests pass
node scripts/smoke-failover.mjs    # 8/8 checks pass (with mock providers)
node bin/mycode.js --help / --version / doctor / skills / sessions / config list
node bin/mycode.js review README.md
node bin/mycode.js a2a-server --port 3000
```

Plus two purpose-built runtime probes: a capture server that records the exact request the CLI
sends to a provider (to prove what is in the system prompt and tool array), and a mock-provider
agent run (to prove the autonomous loop executes tools).

---

## 1. All 9 CLI commands — 🟡 8 of 9

README's command table lists: `chat`, `agent`, `explain`, `fix`, `edit`, **`review`**, `config`, `init`, `doctor`.

The dispatcher is a `switch` in `packages/cli/src/mycode.ts`. Actual cases:
`init|setup`, `config`, `chat|run`, `explain`, `fix`, `edit`, `agent`, `skills`, `sessions`, `doctor`, `--version`, `--help`.

Runtime proof:

```
$ node bin/mycode.js review README.md
Unknown command: review

$ node bin/mycode.js doctor
  Node:      v22.22.3
  Config:    /home/user/.mycode/settings.json ✗ (run mycode init)
  Providers: none
  Skills:    1 in /home/user/.mycode/skills
```

- ❌ `mycode review <file>` — **missing** (there is a `/review` slash command in chat that loads
  the `code-review` skill, but that is not a CLI command).
- ✅ The other 8 work. `chat`/`agent` were additionally exercised end-to-end; `explain`/`fix`/`edit`
  are covered by their passing test suites.
- ➕ The CLI has 4 commands the table doesn't list: `run`, `skills`, `sessions`, `setup`.
- ❌ README's "Global Options" (`--provider`, `--verbose`, `--no-color`) are **not parsed anywhere**
  in `mycode.ts` — only `--model` is (`--model` is handled for `chat` only).

## 2. Any AI provider + auto failover — ✅ Yes (the strongest feature)

Providers (`packages/core/src/routing/`):

| `apiProvider` | Class | Notes |
|:---|:---|:---|
| `openai`, `openrouter`, `nvidia_nim`, `custom` | `OpenAICompatibleProvider` | one code path, different base URLs — this is what makes "any provider" true |
| `ollama` | `OllamaProvider` | native, no key needed |
| `anthropic` | `AnthropicProvider` | native Messages API (extended thinking, prompt caching, native tool schemas) |

The `init` wizard accepts `openai/anthropic/openrouter/ollama/custom` plus a free-form base URL
(`packages/cli/src/commands/init.ts:68-100`), so any OpenAI-compatible endpoint works.

Failover is not marketing — `FailoverCoordinator` (`packages/core/src/routing/failover.ts`) handles
the four hard parts: it announces the switch, checkpoints the session to disk *before* continuing,
re-orients the new model, and recomputes the safe context window for the now-weaker provider
(`WINDOW_HINTS` / `effectiveWindowFor` / `safeContextWindow`). It is wired into both
`chat.ts:302` and `agent.ts:57`. 21 unit tests cover it.

End-to-end proof (mock provider returning HTTP 429, backed by a healthy one):

```
$ node scripts/smoke-failover.mjs
  ↻ Switching primary → backup (rate limit)
  ✦ Using backup (claude-sonnet-4)
  ↻ Provider failover  primary → backup  rate limited
    Context preserved and checkpointed; the agent will continue where it left off.

  ✓ the task actually completed on the backup
  ✓ session checkpointed to disk
  ✓ checkpoint carries the conversation
  8/8 checks passed
```

## 3. Autonomous agent mode (8 tools) — ✅ mode exists, ⚠️ "8 tools" is wrong

`mycode agent [task]` runs a real autonomous loop (`AgentSession`, `maxIterations: 50`) with
confirmation-gated writes, plan/todo panel, sub-agent delegation, and post-write verification.
It is not a chat wrapper: **22 tools across 6 toolsets** are registered
(`packages/core/src/tools/tool-registry.ts`), and all 22 are advertised to the model through
native tool-calling — captured from the outgoing HTTP request:

```
native tool-calling tools sent: 22
read_file, write_file, patch, list_dir, glob, search_files, read_document, read_pdf,
terminal, process, execute_code, git_status, web_search, web_fetch, skills_list,
skill_view, skill_manage, todo_write, read_instructions, memory, delegate, question
```

Proof the loop actually acts — mock provider driving one tool turn:

```
$ mycode agent "create a hello file" --yolo
Agent: create a hello file
  ✦ Using mock (mock-model)
- ⬡ read_file
✔ read_file
```

README's 8-row tool table maps to reality as follows:
`read_file` ✅, `write_file` ✅, `edit_file` → alias of `patch` ⚠️, `list_directory` → alias of
`list_dir` ⚠️, `search_files` ✅, **`search_code` ❌ (no such tool — zero references in the
codebase; content search is `search_files`)**, `run_command` → alias of `terminal` ⚠️, `web_search` ✅.

**Bottom line:** agent mode is real and richer than advertised; the "8 tools" figure is stale.

## 4. MYCODE.md project context — ✅ Yes (verified at runtime)

`packages/core/src/prompts/system-prompt.ts` searches, in order:
`MYCODE.md`, `AGENTS.md`, `CLAUDE.md`, `.mycode/MYCODE.md`, `.cursorrules`, `GEMINI.md` —
plus the global `~/.mycode/MYCODE.md`, walking from the git root down to cwd so nested files stack
(20 000-char cap each). It is also exposed to the model as the `read_instructions` tool, and
`/init`... (`slash-commands.ts:1284`) generates/updates the file.

Runtime proof — a project `.mycode/MYCODE.md` containing `PROJECT_MARKER_XYZ` was placed in a fresh
directory and the actual provider request was captured:

```
request captured: true
message roles: system, user
system prompt length: 7751
MYCODE.md marker injected: true
```

This repo itself ships `.mycode/MYCODE.md`, so the feature is dogfooded.

## 5. SDK, plugins & custom providers — 🟡 Partial (plugins absent)

**Custom providers — ✅ real.** Verified above; `custom` routes through the OpenAI-compatible
client with a user-supplied `baseUrl`.

**SDK — 🟡 exists, but not the SDK the README describes.** `packages/sdk/` exports `MyCodeAgent`,
`discoverSkills`, `createSkill`… and works as a programmatic API over the same core. But README's
snippet (`import { MyCodeSDK } from '@mycode/sdk'; sdk.registerTool(...); sdk.registerProvider(...)`)
does **not** exist — there is no `MyCodeSDK` class, no `registerTool`, no `registerProvider`
(`grep` over `packages/` finds none outside the internal `ToolRegistry.register`). The package is
also `"private": true` and **not published** — `npm view @mycode/sdk` → 404, while the root
`@ankitkumar131/mycode-ai@3.2.1` is live on npm.

**Plugins — ❌ none.** `grep -rn -i "plugin" packages --include=*.ts` returns **zero** matches. The
repo's own audit agrees: `docs/opencode-vs-mycode.md` line 93 says *"MyCode has skills and MCP; it
has no plugin host"* and line 232 scores "Plugin host (contribute agents/commands/providers)" as
`missing`.

What *does* exist as extension surface (all real, none of it "plugins"):
MCP client + tool bridge (`mcp/mcp-client.ts`, `mcp/tool-bridge.ts`), a hooks registry
(`hooks/hooks.ts`), skills (`SKILL.md` discovery, bundled skills), custom slash commands from
`.mycode/commands/*.md`, and agents contributed via `agentService.register()`.

## 6. A2A protocol server — ❌ Not implemented (stub)

The entire protocol implementation is 9 lines:

```ts
// packages/a2a-server/src/server.ts
export class A2AServer {
  constructor(private config: A2AConfig) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
```

- No HTTP server, no agent card, no JSON-RPC/task lifecycle, no message sending — `types.ts` is
  two interfaces (`A2AConfig`, `A2AClient`).
- README tells users to run `mycode a2a-server --port 3000`; that command does not exist:
  ```
  $ node bin/mycode.js a2a-server --port 3000
  Unknown command: a2a-server
  ```
- The package has no `bin`, is `"private": true`, is unpublished (`npm view @mycode/a2a-server`
  → 404), has zero tests, and nothing imports it. The stub is identical on the sibling
  `arena/01a0f6a5-mycode-ai` dev branch — it was never implemented anywhere in this lineage.

## 7. Standalone binary builds — 🟡 Bundle yes, native binary no

`scripts/build.mjs` builds `packages/cli/dist/mycode-standalone.cjs` (12.7 MB, created last by
`npm run build`), bundling every workspace package with only Node builtins external, and
`bin/mycode.js` prefers it over the workspace build. Verified:

```
$ node -e "...scan requires in mycode-standalone.cjs..."
non-builtin requires: ['crypto','fs','path','os','zlib','http','https','url','./pdf.js/**/*/build/pdf.js','child_process']
size MB: 12.7
```

So it is a **self-contained JS bundle** — genuinely useful (no `node_modules` needed), but it is
**not** a Single Executable Application as the README claims ("Build as a Single Executable App —
no Node.js required to run"). Evidence it doesn't exist:

- No `sea-config`, `postject`, `pkg`, or `nexe` anywhere in the repo (excluding `node_modules`).
- README's roadmap claims `[x] Single Executable Application (SEA) builds` — the checkbox is wrong.
- No `.github/workflows` at all, so no per-platform binaries are produced or released.
- The bundle still requires Node ≥ 20 (`engines`), i.e. exactly what SEA was meant to remove.

---

## Doc ↔ reality gaps worth fixing (all reproduced above)

| Severity | Gap | Location |
|:---|:---|:---|
| High | `mycode a2a-server` documented, command doesn't exist; server is an empty stub | README:503-511, `packages/a2a-server/src/server.ts` |
| High | "Plugin" support advertised in the hero card and SDK section — no plugin host exists | README:152-155, 472-500 |
| High | README's SDK snippet (`MyCodeSDK`, `registerTool`, `registerProvider`) is not a real API | README:477-497 |
| High | "Single Executable Application — no Node.js required" / `[x] SEA builds` — not implemented | README:169-170, 559 |
| Medium | `mycode review` listed as one of the CLI commands — not implemented | README:277 |
| Medium | `search_code` listed as an agent tool — no such tool | README:312 |
| Medium | "8 tools" understates the real surface (22) and names 3 aliases as if they were tools | README:303-314 |
| Low | `--provider`, `--verbose`, `--no-color` "Global Options" are not parsed | README:283-289 |
| Low | `mycode config reset` documented; actual subcommands are `list`/`test`/`remove` | README:373-379, `commands/config.ts` |
| Low | `package-lock.json` still pins workspace packages at 3.2.0 while `package.json` says 3.2.1 | `package-lock.json:4543+` |

## What is genuinely solid

1. **Failover** — designed for the hard parts (announce, checkpoint before continuing, re-orient,
   re-size the window) and proven end-to-end, not just unit-tested.
2. **Provider breadth** — one OpenAI-compatible path covers "any provider"; Anthropic and Ollama
   get native implementations.
3. **Context files** — MYCODE.md plus the whole family of agent-instruction filenames, hierarchical
   and injected into the prompt (confirmed in the wire request).
4. **Engineering hygiene** — 445/445 tests pass, monorepo-aware build, hermetic smoke tests
   (throwaway `HOME`), and a dependency-free self-contained CLI bundle.
