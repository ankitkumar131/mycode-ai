# Production-Grade Command Execution Feature

Upgrade MyCode's command execution from a basic synchronous `execSync` wrapper to a full-featured, professional-grade system on par with Claude Code, Gemini CLI, and similar tools. The current implementation has critical limitations: no real-time streaming output, no long-running process support, no interactive command handling, and a simplistic safety model.

## User Review Required

> [!IMPORTANT]
> **Timeout Behavior:** Currently commands hard-timeout at 60 seconds. The new system will support configurable timeouts with a default of 120 seconds and an unlimited option (`timeout: 0`) for long-running commands like `npm install`, builds, or test suites. Is this acceptable?

> [!IMPORTANT]
> **Shell Selection:** On Windows, we'll default to `cmd.exe` for maximum compatibility (matching how Claude Code works on Windows). PowerShell will be available via a `--shell powershell` flag. Is this the right default?

## Open Questions

1. **Background Commands:** Should we support fire-and-forget background commands (e.g., `npm run dev &`) in V1, or defer to V2? These require process lifecycle management.
2. **Environment Variables:** Should commands inherit the full parent process environment, or should we provide a way to inject custom env vars via `MYCODE.md` config?

---

## Current Problems

| Problem | Impact |
|---|---|
| `execSync` blocks the entire Node.js event loop | No real-time output streaming, no Ctrl+C during execution |
| 60s hard timeout, not configurable | Long builds/installs get killed silently |
| Only captures stdout/stderr after completion | User sees nothing until command finishes or fails |
| No stdin support | Can't handle `y/n` prompts from child processes |
| No working directory validation | Commands can silently run in wrong directory |
| Simplistic blocklist safety model | Easy to bypass, doesn't cover Windows-specific dangers |
| No command history or tracking | Can't review what was executed in a session |

---

## Proposed Changes

### 1. Core: New Command Executor Engine

#### [NEW] [src/tools/command-executor.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/command-executor.js)

The heart of the new system — replaces `execSync` with `child_process.spawn` for real-time streaming.

**Key capabilities:**
- **Real-time output streaming** — stdout/stderr streamed line-by-line to terminal as the command runs
- **Configurable timeouts** — default 120s, configurable per-command, `0` for unlimited
- **Ctrl+C forwarding** — user can abort running commands with Ctrl+C (sends SIGTERM to child process tree via `tree-kill`)
- **Exit code tracking** — captures exit code, signal, and timing
- **Output buffering** — streams to terminal AND buffers for AI context (truncated at 30KB for token efficiency)
- **Shell detection** — auto-detects OS and uses appropriate shell (`cmd.exe` on Windows, `bash`/`sh` on Unix)
- **Working directory validation** — verifies cwd exists before execution
- **stderr separation** — stderr lines prefixed with `⚠` for visual distinction

```
Architecture:
┌─────────────────────────────────────────┐
│           CommandExecutor               │
│                                         │
│  spawn(command, {cwd, timeout, shell})  │
│         │                               │
│         ▼                               │
│  ┌─────────────┐    ┌──────────────┐    │
│  │  stdout pipe ├───►│ Line buffer  ├──► Terminal (real-time)
│  └─────────────┘    └──────────────┘    │
│  ┌─────────────┐    ┌──────────────┐    │
│  │  stderr pipe ├───►│ Line buffer  ├──► Terminal (⚠ prefixed)
│  └─────────────┘    └──────────────┘    │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │  Result Buffer (for AI context)  │   │
│  │  - Capped at 30KB               │   │
│  │  - Head + tail on overflow       │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Ctrl+C ──► tree-kill(pid) ──► cleanup  │
└─────────────────────────────────────────┘
```

---

#### [MODIFY] [exec-command.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/exec-command.js)

Complete rewrite of the tool to use the new `CommandExecutor`:

- Uses `CommandExecutor` instead of `execSync`
- Enhanced tool definition with new parameters: `timeout`, `background`
- Improved safety system with:
  - **Categorized danger levels**: `blocked` (never allowed), `dangerous` (extra warning), `elevated` (needs explicit confirm)
  - **Windows-specific patterns**: `format`, `diskpart`, `reg delete`, etc.
  - **Pipe/chain detection**: warns when commands use `|`, `&&`, `;` (potential injection)
  - **Path traversal detection**: warns on `../../` patterns
- Returns structured result with exit code, duration, truncation info
- Environment variable passthrough

---

### 2. Enhanced Safety & Permissions System

#### [NEW] [src/tools/command-safety.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/command-safety.js)

Dedicated safety module with comprehensive command classification:

```
Safety Levels:
├── BLOCKED — Never execute (rm -rf /, format c:, fork bombs)
├── DANGEROUS — Require extra confirmation + warning banner
│   ├── Destructive file ops (rm -r, del /s, rmdir)
│   ├── Git force ops (push --force, reset --hard)
│   ├── Package publishing (npm publish)
│   ├── System modification (chmod, chown, registry edits)
│   └── Process killing (kill, taskkill)
├── ELEVATED — Standard confirmation with context
│   ├── Package install (npm install, pip install)
│   ├── Git commits and pushes
│   └── Docker operations
└── NORMAL — Standard confirmation
    ├── File reads (cat, type, dir, ls)
    ├── Git status/log/diff
    ├── Build/test commands
    └── Everything else
```

---

### 3. Real-Time Terminal UI for Commands

#### [MODIFY] [prompt.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/prompt.js)

Enhanced command confirmation with:
- **Color-coded safety banners** — red for dangerous, yellow for elevated, blue for normal
- **Command breakdown display** — shows the command, working directory, safety level, and timeout
- **"Always allow" option** — for repeated commands like `npm test` within a session (stored in-memory only, not persisted)

#### [NEW] [src/ui/command-output.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/command-output.js)

Real-time command output renderer:
- **Streaming output display** — lines appear as the command produces them
- **stderr highlighting** — stderr lines shown in red/yellow
- **Output box** — bordered box with command header showing `$ command` and working directory
- **Progress indicator** — elapsed time counter while command is running
- **Truncation notice** — shows when output exceeds display limit with byte count
- **Exit status footer** — shows exit code, duration, signal (if killed)

---

### 4. Agent Loop Integration

#### [MODIFY] [loop.js](file:///c:/Users/Admin/Desktop/mycode/src/agent/loop.js)

Update `_handleToolCalls` to support the new async command execution:
- Don't show the tool spinner while a command is actively streaming output (it would conflict)
- Pass through Ctrl+C to the running command's process tree instead of aborting the agent loop
- Handle the new structured result format from the command executor

#### [MODIFY] [system-prompt.js](file:///c:/Users/Admin/Desktop/mycode/src/agent/system-prompt.js)

Enhanced instructions for the AI on command execution:
- Guide the AI to use appropriate timeouts for known long-running commands
- Instruct the AI to check command exit codes and stderr in results
- Tell the AI about available shell and OS context

---

### 5. Session Command History

#### [NEW] [src/tools/command-history.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/command-history.js)

Track all commands executed in a session:
- Stores: command, cwd, exit code, duration, truncated output
- Accessible via `/history` slash command in chat/agent REPL
- Helps the AI avoid re-running the same command
- Shown in system prompt context so the AI knows what was already run

---

### 6. Chat/Agent REPL Enhancements

#### [MODIFY] [chat.js](file:///c:/Users/Admin/Desktop/mycode/src/commands/chat.js)

New slash commands:
- `/history` — show commands executed this session
- `/run <command>` — execute a shell command directly (bypass AI, like Claude Code's `!` prefix)
- `/shell` — show current shell info

#### [MODIFY] [agent.js](file:///c:/Users/Admin/Desktop/mycode/src/commands/agent.js)

Same slash command additions as chat.

---

## Complete File Change Summary

| File | Action | Description |
|---|---|---|
| `src/tools/command-executor.js` | **NEW** | Spawn-based async command execution engine |
| `src/tools/command-safety.js` | **NEW** | Command classification and safety system |
| `src/tools/command-history.js` | **NEW** | Session command history tracking |
| `src/ui/command-output.js` | **NEW** | Real-time command output renderer |
| `src/tools/exec-command.js` | **REWRITE** | Use new executor, enhanced params & safety |
| `src/tools/registry.js` | **MODIFY** | Update tool definitions |
| `src/agent/loop.js` | **MODIFY** | Async command support, Ctrl+C forwarding |
| `src/agent/system-prompt.js` | **MODIFY** | Enhanced command execution instructions |
| `src/ui/prompt.js` | **MODIFY** | Enhanced command confirmation UI |
| `src/commands/chat.js` | **MODIFY** | Add /history, /run, /shell commands |
| `src/commands/agent.js` | **MODIFY** | Add /history, /run, /shell commands |
| `tests/command-executor.test.js` | **NEW** | Tests for the command executor |
| `tests/command-safety.test.js` | **NEW** | Tests for the safety system |

---

## Verification Plan

### Automated Tests
```bash
# Run all tests
node --test tests/*.test.js

# Specifically test the new command execution
node --test tests/command-executor.test.js
node --test tests/command-safety.test.js
```

### Manual Verification
1. **Real-time streaming**: Run `mycode chat`, ask AI to run `ping localhost -n 5` — output should stream line by line
2. **Long-running commands**: Ask AI to run `npm install` in a project — should not timeout
3. **Ctrl+C**: Start a long command, press Ctrl+C — should kill the child process, not crash the agent
4. **Safety system**: Ask AI to run `rm -rf /` — should be blocked. Ask to run `git push --force` — should show danger warning
5. **Command history**: Run several commands, then type `/history` — should show all commands with exit codes
6. **Direct execution**: Type `/run dir` in REPL — should execute directly without AI
7. **Windows compatibility**: Test with `dir`, `type`, `echo`, `git status`, `npm test` on Windows
