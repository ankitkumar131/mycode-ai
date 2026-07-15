# MyCode — Implementation Tasks

## Phase 1: Package Scaffold + Config System + Provider Router
- [ ] Initialize npm project with package.json
- [ ] Create bin/mycode.js entry point
- [ ] Create src/utils/config.js — config file management
- [ ] Create src/utils/logger.js — logging utility
- [ ] Create src/utils/errors.js — error types
- [ ] Create src/providers/base-provider.js — abstract interface
- [ ] Create src/providers/router.js — priority failover engine
- [ ] Create src/commands/init.js — setup wizard
- [ ] Create src/commands/config.js — manage providers
- [ ] Wire up CLI commands in bin/mycode.js

## Phase 2: Provider Implementations
- [ ] Create src/providers/openai-compatible.js — OpenRouter, NIM, custom
- [ ] Create src/providers/ollama-provider.js — local Ollama
- [ ] Test provider connectivity

## Phase 3: Chat Command + Terminal UI
- [ ] Create src/ui/renderer.js — markdown rendering
- [ ] Create src/ui/spinner.js — loading indicators
- [ ] Create src/ui/prompt.js — confirmation dialogs
- [ ] Create src/commands/chat.js — interactive REPL chat
- [ ] Test chat with streaming responses

## Phase 4: Tool System + Agentic Loop
- [ ] Create src/tools/read-file.js
- [ ] Create src/tools/write-file.js
- [ ] Create src/tools/edit-file.js
- [ ] Create src/tools/list-dir.js
- [ ] Create src/tools/search-files.js
- [ ] Create src/tools/exec-command.js
- [ ] Create src/tools/git-status.js
- [ ] Create src/tools/registry.js — tool registration & dispatch
- [ ] Create src/agent/system-prompt.js
- [ ] Create src/agent/context.js
- [ ] Create src/agent/loop.js — core agentic loop

## Phase 5: Remaining Commands
- [ ] Create src/commands/explain.js
- [ ] Create src/commands/fix.js
- [ ] Create src/commands/edit.js
- [ ] Create src/commands/agent.js

## Phase 6: Polish
- [ ] Add .gitignore
- [ ] Add README.md
- [ ] Test global install with npm install -g .
- [ ] End-to-end testing of failover
- [ ] End-to-end testing of agent mode
