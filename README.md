<div align="center">

# MyCode

**A provider-agnostic AI coding agent for your terminal.**

Bring your own API key. Chain providers by priority. When one rate-limits or goes down,
MyCode switches, checkpoints, and keeps working.

[![npm](https://img.shields.io/npm/v/@ankitkumar131/mycode-ai?style=flat-square)](https://www.npmjs.com/package/@ankitkumar131/mycode-ai)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](https://nodejs.org)
[![providers](https://img.shields.io/badge/providers-any%20OpenAI--compatible-8b5cf6?style=flat-square)](#providers)

```bash
npm install -g @ankitkumar131/mycode-ai
```

[Quick start](#quick-start) · [Providers](#providers) · [Failover](#automatic-failover) · [CLI](#cli-reference) · [Agent tools](#agent-mode) · [Skills](#skills) · [MCP](#mcp-model-context-protocol) · [Context](#project-context-mycode-md) · [Config](#configuration) · [Architecture](#architecture)

</div>

---

## Why MyCode

Most coding agents assume one model vendor. MyCode assumes you have several, and treats switching
between them as a first-class operation rather than an error path.

| | |
|:---|:---|
| 🔌 **Any OpenAI-compatible endpoint** | OpenRouter, OpenAI, Ollama, NVIDIA NIM, Groq, Together, Fireworks, Mistral, DeepSeek, LM Studio, vLLM, Azure — one code path, your base URL |
| 🧠 **Native Anthropic support** | Speaks the Messages API directly: extended thinking, prompt caching, native tool schemas — not a compatibility shim |
| 🛟 **Automatic failover** | Providers are chained by priority. Rate limit, outage, auth failure or context overflow → the next provider takes over, the session is checkpointed first, and the replacement model is told what happened |
| 🤖 **Autonomous agent mode** | 22 tools across six toolsets, plan tracking, sub-agent delegation, post-write verification, undoable edits |
| 📁 **Project context** | `MYCODE.md` (plus `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `GEMINI.md`) is read hierarchically and injected into every request |
| 🧩 **Skills & MCP** | `SKILL.md` skills and Model Context Protocol servers both surface as ordinary tools to the agent |
| 🛡️ **Safety by default** | Writes and shell commands ask for confirmation, dangerous patterns are hard-blocked, and each provider has its own read/write permission |
| 🧪 **Zero-dependency runtime** | The published CLI is one self-contained ~13 MB bundle; no `node_modules` at run time |

---

## Quick start

### 1. Install

Requires **Node.js 20+**.

```bash
npm install -g @ankitkumar131/mycode-ai

mycode --version     # MyCode CLI v3.2.1 (@ankitkumar131/mycode-ai)
mycode doctor        # environment + configuration summary
```

### 2. Configure a provider

```bash
mycode init
```

The wizard walks through nine prompts. Only the first six normally need input — the rest have
sensible defaults:

```text
MyCode Setup

Priority (1): 1
Provider name (provider-1): groq
API provider (openai/anthropic/openrouter/ollama/custom): custom
Model (gpt-4o): llama-3.1-70b-versatile
API key: gsk_xxxxxxxx
Base URL: https://api.groq.com/openai/v1
Read permission (true/false) [true]:
Write permission (true/false) [true]:
Max retries (3):

Config saved to: /home/you/.mycode/settings.json
```

Run it again to add a second provider — providers are ordered by priority, and that order is what
failover follows:

```text
Config already exists at: /home/you/.mycode/settings.json

Existing Providers:
  1. groq (custom) — Model: llama-3.1-70b-versatile [Priority 1]

? What would you like to do?
  1. Add a new provider
  2. Change provider priorities
  3. Exit
```

### 3. Start coding

```bash
mycode chat                     # interactive session
mycode chat "explain src/db.ts" # one-shot: chat with a prompt and exit
mycode run "fix the failing test" # same thing under the name other CLIs use
mycode agent                    # autonomous, multi-step, tool-using
```

---

## Providers

MyCode talks to anything that implements the OpenAI chat-completions format, plus a native
Anthropic client and a native Ollama client. `mycode init` accepts five provider types:

| `apiProvider` | Client | Base URL | Notes |
|:---|:---|:---|:---|
| `openai` | OpenAI-compatible | `https://api.openai.com/v1` | default |
| `openrouter` | OpenAI-compatible | `https://openrouter.ai/api/v1` | auto-filled |
| `anthropic` | **Native Messages API** | `https://api.anthropic.com` | auto-filled; thinking + prompt caching |
| `ollama` | **Native Ollama API** | `http://localhost:11434` | auto-filled; no API key needed |
| `custom` | OpenAI-compatible | *you enter it* | Groq, Together, Fireworks, Mistral, DeepSeek, LM Studio, vLLM, Azure, your own gateway |

> **Presets:** the wizard auto-fills the base URL for `ollama`, `openrouter` and `anthropic`
> (and `openai` needs none). For everything else choose **custom** and paste the endpoint — the
> request format is identical. `nvidia_nim` also has a built-in URL, but it is a hand-edit in
> `settings.json` rather than a wizard option.

Every provider entry carries its own **read** and **write** permission, so you can, for example,
answer questions with a free model while restricting file writes to a trusted one.

---

## Automatic failover

Failover is the feature the rest of the design bends around. A mid-task provider switch is not a
cosmetic event — the replacement has a different tokenizer, a different context window, and often
a different tool-calling dialect — so MyCode treats it as four separate problems:

| Problem | What MyCode does |
|:---|:---|
| **The user sees nothing** | The switch is announced, with both provider names and the reason. The status line keeps a running count: `↻ primary -> backup (1 failover)` |
| **State is lost** | The session is checkpointed to `~/.mycode/sessions/` *before* work continues, so a crash mid-switch does not lose the task |
| **The model restarts** | The replacement is handed a re-orientation brief instead of a cold start |
| **The window shrinks** | The safe context window is recomputed for the now-active provider (`effectiveWindowFor` / `safeContextWindow`), so compaction measures against the weakest provider in the chain |

Providers are tried in priority order, filtered by the permissions the current call needs, and
errors are classified rather than string-matched where possible:

| Failure | Reaction |
|:---|:---|
| **429 / rate limit** | The client's retry policy (per-provider `maxRetries`) backs off first, then the next provider serves the request |
| **5xx / provider server error** | Immediate switch to the next provider |
| **401 / 403 / auth** | Switch immediately and warn — the key is not retried on this request |
| **Context overflow** (413, `maximum context`, `token limit`) | Switch to the next provider, which may have a larger window |
| **Connection refused / DNS / timeout** | Switch to the next provider |
| **Model not found, provider overloaded** | Reported with an accurate reason, then switch |

A skipped provider is skipped **for the current request**; MyCode does not maintain a cooldown
clock. `Retry-After` is parsed but not awaited, and the `429` backoff comes from the provider's
HTTP client.

The invariant is covered by a hermetic end-to-end test — a mock provider that always answers `429`
in front of a healthy one, with a throwaway `$HOME`:

```console
$ node scripts/smoke-failover.mjs

  ↻ Switching primary → backup (rate limit)
  ✦ Using backup (claude-sonnet-4)

  ↻ Provider failover  primary → backup
    rate limited
    Context preserved and checkpointed; the agent will continue where it left off.

  ⚡ YOLO · backup/claude-sonnet-4 · 2.0k/128.0k 2% · 0s · ↻ primary -> backup (1 failover)

  ✓ CLI exited cleanly          ✓ the task actually completed on the backup
  ✓ failover announced          ✓ session checkpointed to disk
  ✓ named both providers        ✓ checkpoint carries the conversation
  ✓ gave a reason               ✓ told the user context was preserved
  8/8 checks passed
```

---

## CLI reference

| Command | What it does |
|:---|:---|
| `mycode chat [prompt]` | Interactive session, or a one-shot query when a prompt is given |
| `mycode run [prompt]` | Alias for the one-shot `chat` path (same shape as `opencode run`, `claude -p`) |
| `mycode agent [task]` | Autonomous mode: plans, calls tools, verifies its own writes |
| `mycode explain <file>` | Explanatory walkthrough of a file |
| `mycode fix <file\|error>` | Diagnose and repair, from a path or a pasted error |
| `mycode edit <file> <instruction>` | Targeted AI edit |
| `mycode config list\|test\|remove <name>` | `list` prints the config and its providers, `test` prints each provider's status, `remove` deletes one |
| `mycode init` / `setup` | Setup wizard; re-run to add providers or re-prioritise |
| `mycode skills` | List the skills available on this machine |
| `mycode sessions` | List saved sessions for resuming |
| `mycode doctor` | Environment and configuration summary |
| `mycode --version` / `--help` | Version / usage |

### Chat flags

```bash
mycode chat --continue                 # resume the latest session for this directory
mycode chat --resume <id|title>        # resume a specific saved session
mycode chat --query "why is CI red?"   # one-shot: run this and exit
mycode chat --model <name>             # use a specific configured provider/model
mycode chat --yolo                     # skip approval prompts (alias: --allow-all)
```

### Inside chat

Type `/` for the command palette. Highlights:

| Group | Commands |
|:---|:---|
| Session | `/new` `/clear` `/save` `/resume` `/sessions` `/history` `/title` `/undo [files]` `/compress` |
| Control | `/stop` `/steer <note>` `/queue` `/retry` `/model` `/config` `/status` `/usage` `/diff` |
| Safety | `/allow-all [writes\|commands]` `/yolo` `/tools` `/toolsets` |
| Context | `/context` `/memory` `/plan` `/init` `/review` `/read` `/ls` `/git` |
| Skills | `/skills` `/reload-skills` `/learn` `/skill-creator` |
| Extras | `/theme` `/statusbar` `/timestamps` `/reasoning` `/personality` `/mcp` `/btw` `/about` |
| Ponytail | `/ponytail` `/ponytail-review` `/ponytail-audit` `/ponytail-debt` `/ponytail-gain` `/ponytail-help` |

Also supported inside chat: `!command` runs a shell command, `@file` attaches a file, and custom
slash commands come from markdown files in `.mycode/commands/` (`.opencode/command/` and
`.claude/commands/` are read too).

> **Heads-up:** there is no `mycode review` command — code review lives at `/review` inside chat.
> Large tool outputs are spilled to `~/.mycode/tool-output/` and summarised in context rather than
> dumped wholesale.

---

## Agent mode

`mycode agent` runs an observe → plan → act → verify loop (up to 50 iterations; chat uses 40).
It streams text, shows a todo panel as it plans, and asks before doing anything destructive.

### The 22 built-in tools, by toolset

| Toolset | Tools |
|:---|:---|
| **files** | `read_file` · `write_file` · `patch` · `list_dir` · `glob` · `search_files` · `read_document` · `read_pdf` |
| **terminal** | `terminal` · `process` · `execute_code` |
| **git** | `git_status` |
| **web** | `web_search` · `web_fetch` |
| **skills** | `skills_list` · `skill_view` · `skill_manage` |
| **agent** | `todo_write` · `read_instructions` · `memory` · `delegate` · `question` |

Older names are accepted as aliases (`readFile`, `edit-file`, `list_directory`, `run_command`,
`bash`, `str_replace`, `search_code`→`search_files`, …), so prompts written for other agents keep
working. Toolsets can be restricted per session (`toolsets` in config) and individual tools
disabled (`disabledTools`).

### What makes the loop more than a `while` statement

- **Confirmation gates.** Writes and shell commands prompt before running, with the target and cwd
  shown. `/allow-all` or `--yolo` opts out; the settings file sets the default.
- **Command safety classifier.** Shell commands are graded `blocked` / `dangerous` / `elevated` /
  `normal` before execution — pattern-blocked commands cannot be approved away.
- **Post-write verification.** After a successful write the agent runs the project formatter and
  type/lint diagnostics on the touched files, so it sees its own mistakes on the next turn rather
  than leaving them for you.
- **Undoable edits.** Pre-edit file contents are snapshotted per session; `/undo files` restores
  them.
- **Sub-agents.** `delegate` spawns an `explore` or `general` sub-agent in its own context and
  returns only the report — this is what keeps forty file reads out of the parent's context window.
- **Failover-aware.** An agent run survives a provider switch mid-task (see above).

---

## Skills

Skills are folders containing a `SKILL.md` with frontmatter (`name`, `description`) plus whatever
supporting files the skill needs. Eight ship bundled: `graphify`, `plan`, `code-review`,
`test-driven-development`, `debug`, `commit`, `document-analysis`, `skill-creator`.

Discovery order:

1. **Workspace** — `<project>/.mycode/skills`, `<project>/.agents/skills`, `<project>/skills`
2. **User** — `~/.mycode/skills` (where the bundled set is seeded and newly authored skills are written)
3. **External** — `MYCODE_SKILL_DIRS` (path-separated) or `skills.externalDirs` in config

```bash
mycode skills      # list what's available
```

Inside chat, `/skills` lists them, `/reload-skills` re-scans, `/learn` turns a workflow you just
did into a skill, and `/skill-creator` scaffolds a new one. The agent can also manage skills
itself through `skills_list`, `skill_view` and `skill_manage`.

---

## MCP (Model Context Protocol)

MCP servers plug into the same tool registry the agent already uses — configure them once and
their tools become first-class, namespaced as `server__tool` so two servers can expose the same
name without colliding:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/you/projects"],
        "env": { "LOG_LEVEL": "warn" },
        "enabled": true
      }
    ]
  }
}
```

MyCode spawns the server over stdio, performs the `initialize` handshake, lists its tools and
registers them. Broken or slow servers are isolated: a server that fails to start is reported and the rest of the
agent keeps working. `/mcp` lists each configured server with its connection status.

---

## Project context (`MYCODE.md`)

Drop a `MYCODE.md` in your project and it becomes part of every request:

```markdown
# Project: Billing API

## Stack
- TypeScript, Fastify, Postgres, pnpm

## Conventions
- Functional style; no classes
- Every route needs an integration test
- Migrations are append-only
```

How it is resolved:

- **Hierarchical** — MyCode walks from the git root down to your cwd, so a monorepo can have a
  root file plus per-package ones; they stack in order.
- **Global** — `~/.mycode/MYCODE.md` applies everywhere.
- **Compatible names** — `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and `GEMINI.md` are read too, so
  an existing repo works without renaming anything (first match in each directory wins).
- **On demand** — the agent can re-read it through the `read_instructions` tool, and `/init`
  generates or updates one from a scan of the repo.
- **Durable notes** — `~/.mycode/MEMORY.md` (written via the `memory` tool, shown by `/memory`) is
  for facts that should outlive a single project.

---

## Configuration

Settings live in `~/.mycode/settings.json`:

```json
{
  "version": "1",
  "providers": [
    {
      "priority": 1,
      "name": "openrouter",
      "apiProvider": "openrouter",
      "model": "google/gemini-2.5-flash",
      "apiKey": "sk-or-...",
      "baseUrl": "https://openrouter.ai/api/v1",
      "read": true,
      "write": true,
      "maxRetries": 3,
      "contextWindow": 1000000
    },
    {
      "priority": 2,
      "name": "local-ollama",
      "apiProvider": "ollama",
      "model": "llama3.1:8b",
      "baseUrl": "http://localhost:11434",
      "read": true,
      "write": false
    }
  ],
  "preferences": {
    "theme": "dark",
    "confirmWrites": true,
    "confirmCommands": true,
    "maxContextFiles": 20,
    "logConversations": true
  }
}
```

`contextWindow` is worth setting explicitly: when omitted, MyCode infers it from the model name,
and a wrong guess in either direction costs you (overflow, or needless compaction).

### Other keys

| Key | Purpose |
|:---|:---|
| `mcp.servers[]` | MCP servers (see above) |
| `disabledTools[]` | Tools to switch off for every session |
| `toolsets[]` | Restrict the session to these toolsets (`files`, `terminal`, `git`, `web`, `skills`, `agent`) |
| `skills.externalDirs[]` · `skills.noBundled` | Extra skill directories; skip the bundled set |
| `quickCommands` | `/name` → shell command or alias to another slash command |
| `personalities` | Named system-prompt overlays (`/personality`) |
| `contextWindows` | Per-provider or per-model context window overrides |
| `vimMode` | Vim-style composer keybindings |

> Provider keys accept snake_case too (`api_provider`, `api_key`, `base_url`, `max_retries`), which
> is handy when generating the file from a script. `preferences` are camelCase only.

### Data on disk

```text
~/.mycode/
├── settings.json     configuration (git-ignored by default)
├── sessions/         saved conversations — /save, /resume, mycode sessions
├── skills/           user + seeded bundled skills
├── snapshots/        pre-edit file contents, powering /undo
└── tool-output/      spilled large tool outputs
```

### Environment variables

| Variable | Effect |
|:---|:---|
| `MYCODE_HOME` | Relocate the data directory above (used by tests to stay hermetic) |
| `MYCODE_SKILL_DIRS` | Extra skill directories, path-separated |
| `MYCODE_NO_UPDATE_CHECK=1` | Skip the npm version check on startup |
| `MYCODE_PLAIN=1` · `MYCODE_NO_CURSOR=1` · `MYCODE_NO_KITTY=1` | Simpler rendering for limited terminals |
| `MYCODE_THEME_LIGHT=1` | Prefer the light theme |
| `MYCODE_SKIP_BUILD_CHECK=1` | Don't rebuild when running from a source checkout |
| `PONYTAIL_DEFAULT_MODE=off\|lite\|full\|ultra` | Default intensity of the built-in minimal-code discipline |

---

## Architecture

```text
packages/
├── core/   engine: agent loop, tools, providers, routing + failover, MCP, skills, context
├── cli/    terminal app: commands, composer, renderer, themes, approval prompts
└── sdk/    programmatic API: MyCodeAgent, skills helpers, extension points
```

`core` and `sdk` build as separate published-shaped packages (`@mycode/core`, `@mycode/sdk`) with
`.d.ts` for the whole public surface; the CLI is compiled into a single self-contained bundle that
inlines both.

- **The model never touches a provider directly.** `ProviderRouter` owns provider selection,
  permission filtering and the failover loop; everything above it speaks one interface.
- **Tools are a registry, not a switch.** Each tool is a module declaring a schema, a handler and
  its safety metadata; MCP tools and skills are registered through the same door.
- **The CLI is one bundle.** `scripts/build.mjs` compiles the CLI (and its workspace dependencies)
  into a single CJS file, which is what the published package runs — see `bin/mycode.js`.
- **Text is rendered, not echoed.** Markdown, diffs and tables go through a theme-aware renderer;
  the composer handles multi-line input, paste, and CJK/or wide-character measurement.

### The SDK

The agent loop is usable headlessly. `MyCodeAgent` gives your process the same engine the CLI
runs: provider routing, failover with checkpointing, all 22 tools, verification, and delegation.

```ts
import { MyCodeAgent } from '@mycode/sdk';

const agent = new MyCodeAgent({
  cwd: process.cwd(),
  providers: [primary, fallback],          // tried in priority order
  confirm: async ({ target }) => ask(target),   // your approval UI
});

const answer = await agent.run('summarise the open TODOs', {
  signal: abortController.signal,
  events: {
    onText: (t) => process.stdout.write(t),
    onToolCall: (c) => log(`→ ${c.name}`),
    onFailover: (e) => warn(`${e.from} → ${e.to} (${e.reason})`),
  },
});
```

| | |
|:---|:---|
| **Approvals fail closed** | Writes and shell commands are refused unless you pass `confirm` or opt into `autoApprove: true`. The model is told the call was cancelled and keeps going, so nothing is written by accident. |
| **Extensions** | `registerTool()` (model-callable, appears in the tool list) and `registerProvider()` (route any `apiProvider` id to your own `BaseProvider` subclass — the SDK wraps `ProviderRouter`'s factory registry). |
| **Skills** | `loadSkills(dir)` discovers `<dir>/<name>/SKILL.md` and feeds the agent's skill index, so `skill_view` works exactly as in the CLI. Complements the bundled set. |
| **Events** | `onText`, `onReasoning`, `onToolCall`, `onToolResult`, `onError`, `onUsage`, `onFailover`, `onCompress`, `onFinish`. |
| **Lifecycle** | `newSession()`, `getSession()`, `getInfo()`, `listProviders()`, `loadConfig(path?)`. |

`packages/sdk/README.md` has the full walkthrough.

**Status — read before adopting.** The SDK *works* (it is what the end-to-end checks exercise), and
both packages are now publishable: no bundler step needs to inline `core`, declarations are emitted
for the public API, and `npm pack` yields 18 kB / 490 kB tarballs. They are **not on npm yet**
because nothing outside this repo consumes them — publishing is deliberately deferred until one of
the consumer features below (A2A, a plugin host, editor integration) actually starts. Until then, consume them from the monorepo
(`npm run build`), or use MCP, which is the supported *stable* extension route today.

## Development

```bash
npm install            # Node 20+
npm run build          # esbuild → core, sdk, cli (+ the standalone CLI bundle)
npm run build:types    # emit .d.ts for core and sdk
npm test               # vitest: 464 tests in 41 files
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier

# hermetic, offline end-to-end checks (no API key needed)
npm run smoke:mock-failover &   # two mock providers: one always 429, one healthy
npm run smoke:failover          # asserts switch + checkpoint + continuation (8/8)

npm run eval           # head-to-head benchmark harness against other agents
npm run eval:report    # render the last run
```

`npm run dev` watches the CLI. When running from a checkout, the launcher rebuilds automatically if
sources are newer than the bundle (disable with `MYCODE_SKIP_BUILD_CHECK=1`).

---

## What's not here yet

Written down so nobody has to discover it by grepping:

- **A2A (Agent-to-Agent) protocol server** — not implemented. The package that used to claim it has
  been removed rather than left as a stub.
- **Plugin host** — there is no third-party plugin system that can contribute agents, commands or
  providers. Skills and MCP cover the same needs today; see
  [`docs/opencode-vs-mycode.md`](docs/opencode-vs-mycode.md) for the full comparison.
- **Single Executable Application (SEA) builds** — `npm run build` produces a self-contained ~13 MB
  CLI *bundle* (no runtime dependencies), but it still requires Node 20+. There are no
  per-platform binaries and no release pipeline.
- **`mycode review` / `mycode a2a-server`** — neither is a command. Use `/review` in chat.
- **Nothing is published to npm** — `@mycode/core` and `@mycode/sdk` are publishable but
  unpublished; the CLI is the only installable artifact (`@ankitkumar131/mycode-ai`).
- **`doctor` and `config test` are summaries, not probes** — they report configuration and provider
  order; they do not make network requests, so "active" means "configured", not "reachable".
- **One outbound call on start-up** — the CLI checks npm for a newer version (3 s timeout).
  Disable it with `MYCODE_NO_UPDATE_CHECK=1`.

---

## Licence

MIT — see [LICENSE](LICENSE). Third-party notices, including the vendored
[Ponytail](https://github.com/DietrichGebert/ponytail) prompt discipline and the Apache-2.0
`graphify` skill, are in [NOTICE.md](NOTICE.md).

<div align="center">
<sub>Project documents: <a href="docs/opencode-vs-mycode.md">capability comparison</a> · <a href="feature-verification.md">feature verification</a> · <a href="website-vs-app.md">docs vs. reality audit</a> · <a href="dead-code-audit.md">dead-code audit</a></sub>
</div>
