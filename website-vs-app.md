# Website vs application — fact-check

**Pages checked**

- Marketing site: <https://mycodeai.antideploy.app/>
- Documentation: <https://mycodeai.antideploy.app/docs>

**Against**: this repository at branch `arena/546d4550-mycode-ai` (base `backup_latest_arena/01a0f6a5-mycode-ai` = `8a8606c`), package version **3.2.1**, Node v22.22.3
**Date**: 2026-10-08 · **Companion doc**: [`feature-verification.md`](./feature-verification.md) (the same 7 claims, checked against the code and runtime)

> The docs page is a rendered copy of `README.md` ("Edit on GitHub" points at `README.md`), so every README gap from part 1 reappears there — and the marketing site's pricing tier repeats the same seven claims. The three surfaces are checked separately below where they diverge.

## Verdict at a glance

| Area | Site / docs say | App actually does | Verdict |
|:---|:---|:---|:---|
| Install | `npm i -g @ankitkumar131/mycode-ai`, Node 20+ | published, 3.2.1, installs and runs | ✅ |
| Setup wizard | "asks for just **four things**" | asks **nine** questions | 🟡 |
| Wizard transcript | `? Choose your AI provider:` select + `✓ Added provider: groq` | free-text `API provider (openai/anthropic/openrouter/ollama/custom)` + `Config saved to: …` | 🟡 |
| Provider **presets** | 10 providers listed as presets with base URLs | 5 accepted types; URLs auto-filled for **3**; the other 7 = "Custom" + paste | 🟡 |
| Any OpenAI-compatible endpoint | works | works (verified end-to-end) | ✅ |
| Automatic failover | chain by priority, switch on rate limit/outage/context | proven 8/8 by the smoke test | ✅ |
| Failover reaction table | 5 rows (429/5xx/401-403/413/ECONNREFUSED) | classification matches; **no cooldown** — "skip" lasts one request | 🟡 |
| CLI commands | 9 commands incl. `review`; `config set/get/list/reset` | **8** commands; no `review`; config = `list/test/remove` | ❌ |
| Global options | `--provider`, `--model`, `--verbose`, `--no-color` on any command | only `--model` (chat); the rest silently ignored | ❌ |
| Agent tools | 8 tools incl. `search_code` | **22** tools; no `search_code`; 3 names are aliases | 🟡 |
| Safety | "**always** require explicit confirmation" | default **on**, but `--yolo`, `/allow-all` and settings can disable it | 🟡 |
| MYCODE.md | loaded into every interaction | verified in the outgoing request | ✅ |
| Configuration | `~/.mycode/settings.json`, snake_case example | ✅ path; snake_case providers **are** read; snake_case *preferences* are silently ignored | 🟡 |
| SDK & plugins | `MyCodeSDK`, `registerTool`, `registerProvider`, plugins | no such API; **no plugin host** at all | ❌ |
| A2A server | `mycode a2a-server --port 3000`; multi-agent orchestration | empty stub; command doesn't exist | ❌ |
| Standalone binary | SEA — "no Node.js required — just download and run" | self-contained 12.7 MB **JS** bundle; still needs Node; no downloadable binary | ❌ |
| Terminal UI | "powered by **Ink**" | no Ink/React anywhere; custom `chalk` + `marked` renderer | ❌ |
| `doctor` | "system diagnostics & **provider health check**" | prints provider *names*; no connectivity test | 🟡 |
| `config test` | "test all provider connections" | builds a router and prints static status; **no network call** | ❌ |
| Pricing tiers | Community lists 9 commands / 8 tools / SDK+plugins / A2A / binaries | same stale claims as README | 🟡 |
| Pro roadmap | "MCP (Model Context Protocol)" — future | **MCP already ships and works** (free) | ✅ under-claim |
| Licence / Node / account | MIT · Node 20+ · no account | MIT (+ NOTICE for vendored Ponytail) · `engines: node >=20` · no account | ✅ |
| Version badge | "Universal AI coding agent · **v1.0**" | package `3.2.1` | 🟡 |

---

## 1. Install & first run — ✅ accurate

```bash
npm install -g @ankitkumar131/mycode-ai     # npm view → 3.2.1, live
mycode --version                            # MyCode CLI v3.2.1 (@ankitkumar131/mycode-ai)
mycode doctor                               # environment + config status
```

"Works on any machine with Node.js 20+" matches `engines: { node: ">=20.0.0" }`. "No account needed" matches — the CLI never authenticates. One footnote for the "everything runs locally" line: `checkForUpdate()` calls the npm registry once per run (3 s timeout) to look for a newer version. Harmless, but it is an outbound request and it isn't mentioned anywhere.

The docs' second install sentence — *"or grab the standalone binary … just download and run it anywhere"* — fails on both halves: nothing is downloadable and nothing is a native executable (see §11).

## 2. Setup wizard — 🟡 the "four things" are nine

The site says the wizard *"asks for just four things: provider, model, API key, and base URL"*. Actual transcript (driven through a PTY against a throwaway `HOME`):

```
MyCode Setup

Priority (1): 1
Provider name (provider-1): groq
API provider (openai/anthropic/openrouter/ollama/custom):
  anthropic uses the native Messages API (thinking + prompt caching)custom
Model (gpt-4o): llama-3.1-70b-versatile
API key: gsk_xxxxxxx
Base URL: https://api.groq.com/openai/v1
Read permission (true/false) [true]:
Write permission (true/false) [true]:
Max retries (3):

Config saved to: /tmp/wsite3/.mycode/settings.json
```

Nine questions, not four (`priority`, `name`, `apiProvider`, `model`, `apiKey`, `baseUrl`, `read`, `write`, `maxRetries`). The extra questions are *useful* — they are what makes the site's "per-provider read/write permissions" and "chain providers by priority" claims real — but the "four things" line is wrong, and the docs' transcript is fiction in two more ways:

- it shows a **select menu** (`? Choose your AI provider: ⚙️ Custom (any OpenAI-compatible endpoint)`), while the app prompts with free text: `API provider (openai/anthropic/openrouter/ollama/custom):`;
- it shows `✓ Added provider: groq`, while the app prints `Config saved to: <path>`.

Run `mycode init` again once a config exists and you get the real menu (`Add a new provider` / `Change provider priorities` / `Exit`) — that part of "add several providers" is accurate.

## 3. Provider presets — 🟡 only three have a URL preset

Both pages present ten providers as presets ("Pick a preset during `mycode init`"). The wizard accepts **five** `apiProvider` values (`openai`, `anthropic`, `openrouter`, `ollama`, `custom` — `init.ts:68-73`) and only auto-fills a base URL for three of them:

```
defaultUrl =
  provider === 'ollama'     ? 'http://localhost:11434'
: provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
: provider === 'anthropic'  ? 'https://api.anthropic.com'
: ''
```

So OpenRouter, Ollama and OpenAI work out of the box (OpenAI only because the OpenAI SDK defaults to `https://api.openai.com/v1` when no URL is passed — the app itself sets nothing). **Groq, Together AI, Fireworks AI, Mistral, DeepSeek and LM Studio have no preset** — the user must choose `custom` and paste the URL by hand. NVIDIA NIM is a special case: the router has a hard-coded URL for `apiProvider: 'nvidia_nim'` (`openai-compatible.ts:25-29`) but the wizard never offers that value, so the built-in URL is reachable only by hand-editing the settings file. That *works* (any OpenAI-compatible endpoint does, proven end-to-end in part 1), so the pitch "If it speaks the OpenAI chat-completions format, MyCode can drive it" holds; the word "preset" and the provider-card grid do not.

The underlying claim — "works with any AI provider" — is the app's strongest genuine feature: one `OpenAICompatibleProvider` path + native Anthropic Messages API + native Ollama.

## 4. Failover — ✅ works, 🟡 table overstates two rows

The site's promise (chain by priority, switch on rate limit / outage / context overflow, "you just keep coding") is real and was proven end-to-end in part 1:

```
↻ Switching primary → backup (rate limit)
↻ Provider failover  primary → backup  rate limited
  Context preserved and checkpointed; the agent will continue where it left off.
8/8 checks passed
↻ primary -> backup (1 failover)     ← shown in the live status line
```

How the five reaction rows actually map:

| Site row | Reality |
|:---|:---|
| **429** — "Wait briefly, then try the next provider" | ✅ in effect, but the "wait" is the OpenAI SDK's own retry/backoff (driven by the `maxRetries` you set in the wizard), then failover. `Retry-After` is parsed into `RateLimitError.retryAfterMs` (`errors.ts:82`) and then ignored — nothing reads it. |
| **5xx** — "Immediately try the next provider" | ✅ `classifyError` → `ProviderServerError` → next provider. |
| **401 / 403** — "Skip the provider and warn you" | 🟡 it switches and warns immediately, but the skip is **not sticky**: `isAvailable` is never set to `false` anywhere in the codebase, so the rejected key is tried again on a later turn (after the working provider has taken the lead). No cooldown, no "disabled" state. |
| **413** — "Try next — it may have a larger window" | 🟡 no HTTP-413 mapping exists; context failures are matched by message text (`maximum context`, `token limit`, `max_tokens`) and switch. The stronger part is protective, not reactive: window sizing is failover-aware (`effectiveWindowFor` / `safeContextWindow`) and compaction runs against the *current* provider's window. |
| **ECONNREFUSED** — "Skip the provider (it's offline)" | 🟡 message-matched (`econnrefused`/`fetch failed`/…), switches for that request only — same non-sticky caveat as 401/403. |

None of this breaks the headline claim. It means "skip" means "skip for the rest of this request", not "mark the provider dead".

## 5. CLI commands & global options — ❌

The docs' own command table and the site's stat tile ("CLI commands — chat · agent · fix · review"):

```
$ mycode review README.md
Unknown command: review
```

`review` does not exist as a command (only the `/review` slash command inside chat). The dispatcher (`mycode.ts`) has `chat|run, init|setup, config, explain, fix, edit, agent, skills, sessions, doctor, --version, --help` — 8 of the 9 documented, plus 4 undocumented ones.

`mycode config` is documented as "set / get / list / **reset**":

```
$ mycode config set      → Unknown subcommand: set
$ mycode config get      → Unknown subcommand: get
$ mycode config reset    → Unknown subcommand: reset
```

Only `list`, `test` and `remove` exist — so the docs example block (`config list`, `config test`, `config reset`) fails on its third line.

The docs' "Global options work with any command" block is entirely inert except `--model` (and only for `chat`). Proven empirically — the config below has `primary` (a provider that always answers HTTP 429) at priority 1 and a healthy `backup` at priority 2, then asks for the backup explicitly:

```bash
mycode chat -Q "hello" --provider backup --yolo
# → ✦ Using primary (gpt-4o)
#   ↻ Switching primary → backup (rate limit)     ← the flag was ignored
```

`--verbose` and `--no-color` are not parsed anywhere either; unknown flags are silently dropped.

## 6. Agent tools — 🟡 22 exist, the documented 8 are stale

Both pages list the same 8 tools. Captured from the real HTTP request, the app advertises **22**:

```
read_file, write_file, patch, list_dir, glob, search_files, read_document, read_pdf,
terminal, process, execute_code, git_status, web_search, web_fetch, skills_list,
skill_view, skill_manage, todo_write, read_instructions, memory, delegate, question
```

Mapping to the site's table: `read_file` ✅ · `write_file` ✅ · `edit_file` → alias of `patch` ⚠️ · `list_directory` → alias of `list_dir` ⚠️ · `search_files` ✅ · **`search_code` ❌ (no such tool — zero references in the codebase)** · `run_command` → alias of `terminal` ⚠️ · `web_search` ✅.

The site undersells the app here: plan tracking (`todo_write` with a live panel), sub-agent delegation, user questions, memory, skills management, document/PDF reading, background processes and sandboxed code execution all exist and are not mentioned.

## 7. Safety — 🟡 "always" is a default, not a law

"All file writes and dangerous shell commands require your explicit confirmation" is true **by default**: `preferences.confirmWrites`/`confirmCommands` default to `true` (`config-manager.ts:81-82`), `--yolo` is off, and a write attempt in a non-interactive run leaves the project directory empty rather than writing.

But it is switchable in three places — `--yolo` / `--allow-all`, `/allow-all` during a session, and the settings file — and chat mode honours the settings (`shouldPrompt()` in `permissions/session-approvals.ts`), so the literal word "always" on both pages is wrong. Also worth knowing: file writes are gated but `write_file`'s "dangerous command" *blocklist* additionally hard-blocks some patterns outright (`command-safety.ts` classifies `blocked` / `dangerous` / `elevated`), which is stronger than advertised.

## 8. Configuration — 🟡 path and snake_case providers fine; preferences silently ignored

- `~/.mycode/settings.json` ✅ correct path.
- The docs' snake_case provider example **loads correctly** — I wrote the docs' exact JSON and got:
  ```
  $ mycode config list
  Path: /tmp/docstest/.mycode/settings.json
  Providers: 2
    my-openrouter (openrouter)   Model: google/gemini-2.5-flash  Status: active
    local-ollama (ollama)        Model: llama3.1:8b            Status: active
  ```
  (`api_provider`, `api_key`, `base_url`, `max_retries` are mapped on read — `SNAKE_TO_CAMEL`, `config-manager.ts:7-12`.)
- But the app **writes camelCase**: `mycode init` saved `"apiProvider": "custom"`, `"apiKey"`, `"baseUrl"`, `"maxRetries"`. So the docs' snippet is valid input yet not what a user will find in their file — a copy-paste round-trip that looks broken.
- **Preferences are not snake-normalized.** The docs use `confirm_writes`, `confirm_commands`, `log_conversations`; the app reads `confirmWrites`, `confirmCommands`, `logConversations`. `grep -rn confirm_writes packages/` → nothing. Consequence: a user who writes `"confirm_writes": false` to stop the prompts gets prompts anyway, with no warning. (`theme: "dark"` from the docs example does work.)
- Undocumented settings that do exist: `mcp.servers`, `vimMode`, `disabledTools`, `toolsets`, `skills.externalDirs`, `quickCommands`, `personalities`, `contextWindows`.

## 9. `doctor` and `config test` — 🟡/❌ neither checks the network

The docs call `mycode doctor` a "provider health check" and `mycode config test` a way to "test all provider connections". Neither makes a request:

```
$ mycode doctor
  Providers: my-openrouter, local-ollama      ← names only, no connectivity
```

`config test` builds a `ProviderRouter` and prints `router.getStats()`, which reports the in-memory health flag — and since `isAvailable` is never set to `false` (§4), it prints `active` for every provider, reachable or not. This is the one place where a *documented diagnostic* gives a user false confidence.

## 10. SDK, plugins & A2A — ❌ as documented; MCP is the opposite problem

Both pages promise `MyCodeSDK` with `registerTool` / `registerProvider` and "plugins that plug straight into the agent loop". Reality (see part 1, §5):

- no `MyCodeSDK` class, no `registerTool`, no `registerProvider` — the real SDK surface is `MyCodeAgent`, `discoverSkills`, `createSkill`, … and it is `private` + unpublished (`npm view @mycode/sdk` → 404);
  - *Update (later work):* `registerTool` and `registerProvider` now exist on `MyCodeAgent` and both packages are publishable (declarations emitted, `@mycode/core` external), but neither is published yet. The site's `MyCodeSDK` class name is still wrong.
- `grep -rn -i "plugin" packages --include=*.ts` → **zero matches**; the repo's own comparison doc says *"MyCode has skills and MCP; it has no plugin host."*

Then:

```
$ mycode a2a-server --port 3000
Unknown command: a2a-server
```

`packages/a2a-server` is a 9-line stub — `start()` and `stop()` are empty, `types.ts` holds two interfaces, nothing imports it, it is unpublished. Nothing on either page hints that this is unimplemented.

**The inverse problem:** the site lists **"MCP (Model Context Protocol)"** under **Pro · roadmap**. MCP already ships and works in the free tier — `mcp.servers` in settings, a `/mcp` slash command that lists servers, `mcpManager.configure()` + `registerMCPTools()` wired into chat (`chat.ts:503-507`), and a real client that spawns the server, performs the JSON-RPC `initialize` handshake and bridges its tools (`mcp/mcp-client.ts`). The site is selling as "future" something users already have.

## 11. Terminal UI & standalone binary — ❌ "powered by Ink", ❌ SEA

**Ink**: the site says the polished terminal experience is "powered by Ink". Ink is not a dependency of any package, and no file imports it. The UI is a hand-rolled renderer — `chalk` for colour, `marked` for markdown, `ora` for spinners, plus a custom theme registry — described in the source as *"Gemini CLI-inspired: clean rendering with syntax highlighting, diff colors, table borders"*. (`packages/cli/src/ui/App.ts` is an empty class stub; the real chat loop lives in `commands/chat.ts`.) The *features* — rich markdown, streaming, spinners, colour, themes, diff viewer — are all real; the attribution is not.

**Standalone binary**: `npm run build` produces `packages/cli/dist/mycode-standalone.cjs` — 12.7 MB, self-contained (only Node builtins external), and `bin/mycode.js` prefers it. That is genuinely useful — no `node_modules` needed. But:

- it is a `.cjs` **JavaScript file that still needs Node ≥ 20** — the opposite of "no Node.js required";
- there is no `sea-config`, `postject`, `pkg` or `nexe` anywhere in the repo, and no CI workflows, so no per-platform executables are built or published;
- nothing on either page links to a download — "just download and run it anywhere" describes an artifact that does not exist.

`README.md` goes further and ticks `[x] Single Executable Application (SEA) builds` in its roadmap.

## 12. Pricing tiers & roadmap — 🟡 the Community tier repeats stale claims

| Tier | Claim | Reality |
|:---|:---|:---|
| Community | "All 9 CLI commands" | 8 of 9 (§5) |
| Community | "Any AI provider + auto failover" | ✅ the app's best feature |
| Community | "Autonomous agent mode (8 tools)" | 22 tools (§6) |
| Community | "MYCODE.md project context" | ✅ verified in the wire request |
| Community | "SDK, plugins & custom providers" | custom providers ✅; SDK API ❌ as documented; plugins ❌ |
| Community | "A2A protocol server" | ❌ stub |
| Community | "Standalone binary builds" | 🟡 JS bundle only |
| Pro | "MCP (Model Context Protocol)" as roadmap | **already shipped, in the free tier** |
| Pro | Web dashboard / VS Code extension / relay / history sync | not in the repo — correctly labelled as roadmap |
| Enterprise | SSO, air-gapped, audit logs, collaboration, SLA | not in the repo — correctly labelled as roadmap |
| Footer | "MIT licensed" | ✅ `LICENSE` (MIT) + `NOTICE.md` disclosing the vendored Ponytail rules (MIT, `DietrichGebert/ponytail` v4.10.0) |
| Hero | "· v1.0" | package is `3.2.1` |

---

## What to fix on the site and docs — priority order

**High (claims users can catch in five minutes)**

1. `mycode a2a-server` — either remove from both pages and the pricing tier, or implement the server (`start()`/`stop()` are empty). The docs literally publish a command that errors.
2. Plugins + SDK example — remove "plugins" and the `registerTool`/`registerProvider` snippet, or build the plugin host and the documented API. `@mycode/sdk` is not even published.
3. Standalone binary — change "Single Executable Application · no Node.js required · download and run anywhere" to "self-contained bundle (still requires Node 20+)" until SEA builds + releases exist. Same for the docs' "No Node.js?" paragraph and README's `[x] SEA`.
4. `mycode review` — either implement the command or drop it from the CLI table and the "9 CLI commands" tile/tier.
5. `mycode config set/get/reset` — the docs table and example block describe three subcommands that don't exist. Publish `list`/`test`/`remove`, or add the others.
6. Global options — remove `--provider`, `--verbose`, `--no-color` (or implement them); `--provider` provably does nothing.

**Medium (accuracy, trust)**

7. Wizard copy: "asks for just four things" → nine prompts; replace the fake transcript (`? Choose your AI provider:` select, `✓ Added provider: groq`) with the real one; either drop "preset" language for Groq/Together/Fireworks/Mistral/DeepSeek/NVIDIA NIM/LM Studio or add URL presets for them.
8. Settings example: document camelCase (what the app writes) or normalize **preferences** as well as provider keys — today `confirm_writes: false` is silently ignored.
9. `doctor` / `config test`: stop calling them a health check / connection test until they probe (`config test` cannot fail a provider that is offline).
10. Failover table: soften "skip the provider" to "skip for this request"; note that the 429 wait is the SDK's retry driven by `maxRetries`, and that `Retry-After` is parsed but unused.
11. Agent tools table: list the real tool names, drop `search_code`, and use the real count (22), not 8.
12. "Always require explicit confirmation" → "confirmed by default; `--yolo`/`/allow-all`/settings can disable".

**Low (polish)**

13. "Powered by Ink" → name what it actually uses, or drop the library name.
14. Version badge `v1.0` vs package `3.2.1`.
15. Move **MCP** out of the Pro roadmap — it is shipped and free today; mention `/mcp`, `mcp.servers`, skills (`SKILL.md`), `skills`/`sessions` commands and custom slash commands, all of which are real and currently unsold.
16. Note the update check's npm-registry call next to "everything runs locally".

## Evidence index (all reproduced locally)

```bash
npm install && npm run build            # ok — 6 packages + 12.7 MB standalone .cjs
npx vitest run                          # 445/445 pass
node scripts/smoke-failover.mjs         # 8/8 — 429 → switch, checkpoint, continue
node bin/mycode.js --version            # 3.2.1  (site badge: v1.0)
node bin/mycode.js review README.md     # Unknown command: review
node bin/mycode.js a2a-server --port 3000   # Unknown command: a2a-server
node bin/mycode.js config set|get|reset     # Unknown subcommand (×3)
node bin/mycode.js doctor               # provider NAMES only, no health probe
mycode chat -Q hi --provider backup --yolo  # flag ignored → fails over from primary
python3 /tmp/drive_init.py              # real 9-question wizard transcript + camelCase save
# docs' exact snake_case settings.json   → loads: Providers: 2
# docs' snake_case preferences           → ignored (grep: no confirm_writes anywhere)
grep -rn -i plugin packages --include=*.ts  # zero matches
grep -rn "\bink\b" package.json packages/*/package.json  # zero matches
```
