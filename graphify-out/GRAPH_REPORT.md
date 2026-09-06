# Graph Report - mycode-ai  (2026-09-06)

## Corpus Check
- 186 files · ~104,869 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1465 nodes · 2994 edges · 88 communities (66 shown, 21 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Text Input UI Testing
- Skills System
- Tool Definitions
- Agent System Prompts
- Chat Command
- Agent Session Context
- Base Provider Layer
- Configuration Management
- Package Dependencies
- Tool Definitions
- Tool Definitions
- Agent Session Management
- CLI Package Config
- Chat Command
- Init Command
- Tool Definitions
- Chat Command
- Configuration Management
- Tool Definitions
- SDK Implementation
- Type Definitions
- Agent Session Management
- Chat Command
- Tool Definitions
- Configuration Management
- Package Dependencies
- Chat Command
- Package Dependencies
- CLI Package Config
- Provider Router
- Base Provider Layer
- Package Dependencies
- Provider Router
- Agent Session Management
- CLI Package Config
- CLI Package Config
- Package Dependencies
- Package Dependencies
- Agent Session Management
- Search Functionality
- UI Rendering
- CLI Package Config
- Tool Registry
- Package Dependencies
- Agent System Prompts
- OpenAI Compatible API
- Base Provider Layer
- Ollama Integration
- Community 48
- Community 49
- Command History
- A2A Server
- CLI Package Config
- Context Resolution
- Type Definitions
- SDK Implementation
- CLI Package Config
- Ollama Integration
- Type Definitions
- Community 59
- Directory Operations
- Community 61
- Community 62
- CLI Package Config
- Agent Session Management
- Test Suite
- Tool Definitions
- Development Tools
- Test Suite
- Community 69
- Community 70
- Update Checker
- Permission Policy
- Command Safety
- Agent Session Management
- CLI Package Config
- Community 76
- Package Dependencies
- CLI Package Config
- Community 79
- Community 80
- Package Dependencies
- Community 82
- Community 83
- CLI Package Config
- Development Tools
- Community 86

## God Nodes (most connected - your core abstractions)
1. `TextArea` - 63 edges
2. `AgentSession` - 46 edges
3. `skillManager` - 44 edges
4. `chatCommand()` - 40 edges
5. `ConfigManager` - 33 edges
6. `ProviderRouter` - 33 edges
7. `ToolRegistry` - 30 edges
8. `ProviderRouter` - 28 edges
9. `ConversationContext` - 27 edges
10. `ToolModule` - 26 edges

## Surprising Connections (you probably didn't know these)
- `MyCode Project` --uses--> `Agentic Loop`  [EXTRACTED]
  .mycode/MYCODE.md → README.md
- `MyCode Project` --has--> `Context Management`  [EXTRACTED]
  .mycode/MYCODE.md → implementation_plan.md
- `MyCode Project` --has--> `Skills System`  [EXTRACTED]
  .mycode/MYCODE.md → README.md
- `MyCode Project` --uses--> `Tool System`  [EXTRACTED]
  .mycode/MYCODE.md → README.md
- `Provider Router` --enables--> `Automatic Failover`  [EXTRACTED]
  .mycode/MYCODE.md → README.md

## Import Cycles
- None detected.

## Communities (88 total, 21 thin omitted)

### Community 0 - "Text Input UI Testing"
Cohesion: 0.05
Nodes (24): COMMANDS, FakeStdin, FakeStdout, CommitSubmit, MenuState, SlashMenuItem, TextArea, TextAreaOptions (+16 more)

### Community 1 - "Skills System"
Cohesion: 0.06
Nodes (28): GRAPHIFY_SKILL_FILES, BUNDLED_SKILLS, BundledSkill, graphifySkill, currentPlatformName(), firstParagraph(), isPlatformCompatible(), listSkillFiles() (+20 more)

### Community 2 - "Tool Definitions"
Cohesion: 0.07
Nodes (28): codeExecTool, gitStatusTool, globSearchTool, listDirTool, readDocumentTool, TEST_DIR, DOC_EXTENSIONS, readFileTool (+20 more)

### Community 3 - "Agent System Prompts"
Cohesion: 0.07
Nodes (30): buildSystemPrompt(), getCommandExecutionGuide(), getEnvironmentContext(), getGitContext(), getIdentityPrompt(), getMycodeInstructions(), getProjectContext(), getToolInstructions() (+22 more)

### Community 4 - "Chat Command"
Cohesion: 0.08
Nodes (28): ChatOptions, contextWindowFor(), fmtDuration(), COMMANDS, BannerOptions, renderBanner(), CommandOutputRenderer, createCommandOutput() (+20 more)

### Community 5 - "Agent Session Context"
Cohesion: 0.07
Nodes (3): ConversationContext, ToolRegistry, ToolDefinition

### Community 6 - "Base Provider Layer"
Cohesion: 0.09
Nodes (9): BaseProvider, OllamaProvider, OpenAICompatibleProvider, AuthError, classifyError(), ContextLengthError, ProviderServerError, RateLimitError (+1 more)

### Community 7 - "Configuration Management"
Cohesion: 0.11
Nodes (19): normalizeProvider(), SNAKE_TO_CAMEL, ProviderConfig, ProviderHealth, SafetyLevel, SafetyResult, SafetyLevel, ToolCall (+11 more)

### Community 8 - "Package Dependencies"
Cohesion: 0.05
Nodes (38): dependencies, chalk, diff, glob, @google/genai, marked, @modelcontextprotocol/sdk, ollama (+30 more)

### Community 9 - "Tool Definitions"
Cohesion: 0.14
Nodes (26): resolveFileReferences(), collapse(), colToIndex(), csvToText(), decodeXmlEntities(), DOCUMENT_EXTENSIONS, DocumentSection, ENTITY_MAP (+18 more)

### Community 10 - "Tool Definitions"
Cohesion: 0.14
Nodes (21): SessionConfig, SessionUsage, Message, EventTranslator, AgentEvent, AgentOptions, Message, SavedSession (+13 more)

### Community 11 - "Agent Session Management"
Cohesion: 0.09
Nodes (17): DANGEROUS_PATTERNS, DEFAULT_RULES, Effect, evaluate(), findLastMatch(), getResource(), PendingRequest, PermissionCheckOptions (+9 more)

### Community 12 - "CLI Package Config"
Cohesion: 0.07
Nodes (27): description, files, chalk, diff, marked, @mycode/core, tree-kill, @types/react (+19 more)

### Community 13 - "Chat Command"
Cohesion: 0.12
Nodes (4): chatCommand(), fmtTokens(), formatProviderLabel(), AgentSession

### Community 14 - "Init Command"
Cohesion: 0.16
Nodes (22): addProviderWizard(), PROVIDER_PRESETS, registerInitCommand(), runInit(), addAlwaysAllow(), _alwaysAllowed, confirm(), confirmCommand() (+14 more)

### Community 15 - "Tool Definitions"
Cohesion: 0.15
Nodes (14): AgentLoop, estimatePromptTokens(), estimateTokens(), makeToolCallKey(), registerAgentCommand(), runAgentTask(), startAgentRepl(), executeTool() (+6 more)

### Community 16 - "Chat Command"
Cohesion: 0.21
Nodes (20): handleSlashCommand(), pkg, registerChatCommand(), singleMessage(), startRepl(), registerConfigCommand(), editFile(), registerEditCommand() (+12 more)

### Community 17 - "Configuration Management"
Cohesion: 0.24
Nodes (7): configCommand(), initCommand(), input(), select(), adjustProviderPriorities(), ConfigManager, MyCodeConfig

### Community 18 - "Tool Definitions"
Cohesion: 0.13
Nodes (16): agentService, buildInfo, compactionInfo, exploreInfo, generalInfo, planInfo, registerBuiltInAgents(), summaryInfo (+8 more)

### Community 19 - "SDK Implementation"
Cohesion: 0.09
Nodes (22): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+14 more)

### Community 20 - "Type Definitions"
Cohesion: 0.10
Nodes (20): author, description, files, homepage, @types/node, @types/react, keywords, license (+12 more)

### Community 21 - "Agent Session Management"
Cohesion: 0.14
Nodes (8): handleAgentSlashCommand(), pkg, executeCommand(), formatDuration(), killProcess(), COLORS, CommandOutputRenderer, createCommandOutput()

### Community 22 - "Chat Command"
Cohesion: 0.23
Nodes (14): agentCommand(), question(), editCommand(), explainCommand(), fixCommand(), renderMarkdown(), argv, CHAT_FLAGS (+6 more)

### Community 23 - "Tool Definitions"
Cohesion: 0.14
Nodes (11): buildShellInvocation(), executeCommand(), ExecutorOptions, execCommandTool, processTool, cleanup(), ManagedProcess, add() (+3 more)

### Community 24 - "Configuration Management"
Cohesion: 0.17
Nodes (6): MCPClient, MCPClientManager, mcpManager, MCPConfig, MCPServerConfig, MCPToolInfo

### Community 25 - "Package Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, chalk, cli-spinners, diff, highlight.js, ink, ink-gradient, ink-spinner (+11 more)

### Community 26 - "Chat Command"
Cohesion: 0.13
Nodes (12): getVersion(), mockQuestion, mockRun, mockSession, mockQuestion, mockRun, mockRun, checkForUpdate() (+4 more)

### Community 27 - "Package Dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @mycode/core, description, devDependencies, @types/node, files, @mycode/core, @types/node (+9 more)

### Community 28 - "CLI Package Config"
Cohesion: 0.14
Nodes (8): buildMenuItems(), CommandDef, findCommand(), getCompletions(), handleSlashCommand(), SlashCommandContext, SlashCommandResult, warn()

### Community 29 - "Provider Router"
Cohesion: 0.15
Nodes (8): AllProvidersExhaustedError, AuthError, ContextLengthError, RateLimitError, ToolExecutionError, mockCreate, mockCreate, mockStream

### Community 30 - "Base Provider Layer"
Cohesion: 0.21
Nodes (3): NoProvidersConfiguredError, BaseProvider, ProviderRouter

### Community 31 - "Package Dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @mycode/core, description, devDependencies, @types/node, files, @mycode/core, @types/node (+9 more)

### Community 32 - "Provider Router"
Cohesion: 0.18
Nodes (3): ProviderRouter, AllProvidersExhaustedError, NoProvidersConfiguredError

### Community 33 - "Agent Session Management"
Cohesion: 0.13
Nodes (16): Agentic Loop, Automatic Failover, CLI Package, Context Management, Core Package, Monorepo Architecture, MYCODE.md File, MyCode Project (+8 more)

### Community 34 - "CLI Package Config"
Cohesion: 0.12
Nodes (16): scripts, build, build:cli, build:core, build:sdk, clean, dev, format (+8 more)

### Community 35 - "CLI Package Config"
Cohesion: 0.24
Nodes (11): renderBlock(), renderBox(), renderCodeBlock(), renderDiffBlock(), renderInline(), renderInlineToken(), renderListItem(), renderTable() (+3 more)

### Community 36 - "Package Dependencies"
Cohesion: 0.13
Nodes (14): description, devDependencies, @types/node, files, @types/node, main, name, private (+6 more)

### Community 37 - "Package Dependencies"
Cohesion: 0.13
Nodes (14): description, devDependencies, @types/node, files, @types/node, main, name, private (+6 more)

### Community 38 - "Agent Session Management"
Cohesion: 0.21
Nodes (3): ConversationContext, estimateTokens(), messageTokens()

### Community 40 - "UI Rendering"
Cohesion: 0.18
Nodes (9): confirmFileWrite(), createReadlineConfirmFns(), askYesNo(), rlConfirmCommand(), rlConfirmFileWrite(), BRAND, marked, renderDiff() (+1 more)

### Community 41 - "CLI Package Config"
Cohesion: 0.26
Nodes (11): addAlwaysAllow(), ALWAYS_ALLOW, askYesNo(), confirm(), confirmCommand(), isAlwaysAllowed(), normalizeCommand(), pickChoiceArrowKeys() (+3 more)

### Community 42 - "Tool Registry"
Cohesion: 0.24
Nodes (3): CommandHistory, ExecuteToolOptions, CommandRecord

### Community 43 - "Package Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, esbuild, eslint, prettier, rimraf, @types/node, @types/react, typescript (+3 more)

### Community 44 - "Agent System Prompts"
Cohesion: 0.25
Nodes (5): CONTEXT_FILE_NAMES, findContextFiles(), readMemory(), SystemPromptBuilder, SystemPromptOptions

### Community 46 - "Base Provider Layer"
Cohesion: 0.22
Nodes (5): BRAND, ICONS, logger, TOOL_META, ProviderStats

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (10): esbuild, args, buildPackage(), __dirname, main(), NODE_BUILTINS, pkgIndex, root (+2 more)

### Community 51 - "A2A Server"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, paths, rootDir, extends, include, ../../tsconfig.json, @mycode/core (+1 more)

### Community 52 - "CLI Package Config"
Cohesion: 0.20
Nodes (9): compilerOptions, noEmit, outDir, paths, extends, include, ../../tsconfig.json, @mycode/core (+1 more)

### Community 54 - "Type Definitions"
Cohesion: 0.33
Nodes (4): HookAggregator, HookRunner, HookDefinition, HookEvent

### Community 55 - "SDK Implementation"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, paths, rootDir, extends, include, ../../tsconfig.json, @mycode/core (+1 more)

### Community 56 - "CLI Package Config"
Cohesion: 0.42
Nodes (3): A2AServer, A2AClient, A2AConfig

### Community 57 - "Ollama Integration"
Cohesion: 0.25
Nodes (4): ProviderServerError, mockChatFn, mockList, TOOL_CAPABLE_MODELS

### Community 59 - "Community 59"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, ../../tsconfig.json, references

### Community 60 - "Directory Operations"
Cohesion: 0.39
Nodes (7): isBinaryOrLarge(), readDirectoryContents(), traverse(), readFileContent(), resolveContextReferences(), SKIP_DIRS, SKIP_EXTS

### Community 61 - "Community 61"
Cohesion: 0.32
Nodes (7): detectFileType(), EXTENSION_MAP, FileCategory, FileInfo, formatBytes(), isBinaryFile(), MAGIC_SIGNATURES

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (6): __dirname, ensureFreshBuild(), newestMtime(), root, standaloneEntry, workspaceEntry

### Community 63 - "CLI Package Config"
Cohesion: 0.43
Nodes (3): MyCodeApp, AppProps, AppState

### Community 64 - "Agent Session Management"
Cohesion: 0.29
Nodes (5): mockBuildSystemPrompt, mockChat, mockExecuteTool, mockGetDefinitions, mockTranslate

### Community 66 - "Tool Definitions"
Cohesion: 0.33
Nodes (4): editFileTool, findAll(), locate(), MatchResult

### Community 67 - "Development Tools"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.json

### Community 68 - "Test Suite"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.json

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (3): dest, files, headers

### Community 71 - "Update Checker"
Cohesion: 0.60
Nodes (4): fetchLatestVersion(), isNewerVersion(), maybeCheckForUpdates(), parseVersion()

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 77 - "Package Dependencies"
Cohesion: 0.67
Nodes (3): devDependencies, ink-testing-library, @types/react

### Community 78 - "CLI Package Config"
Cohesion: 0.67
Nodes (3): scripts, build, typecheck

## Knowledge Gaps
- **368 isolated node(s):** `__dirname`, `root`, `standaloneEntry`, `workspaceEntry`, `name` (+363 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 568 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ora` connect `Chat Command` to `CLI Package Config`, `Chat Command`, `Tool Definitions`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Why does `vitest` connect `Chat Command` to `Text Input UI Testing`, `Tool Definitions`, `CLI Package Config`, `Chat Command`, `Configuration Management`, `Type Definitions`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `TextArea` connect `Text Input UI Testing` to `Chat Command`, `Chat Command`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `chatCommand()` (e.g. with `.abort()` and `.dequeuePrompt()`) actually correct?**
  _`chatCommand()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `__dirname`, `root`, `standaloneEntry` to the rest of the system?**
  _368 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Text Input UI Testing` be split into smaller, more focused modules?**
  _Cohesion score 0.053750597228858096 - nodes in this community are weakly interconnected._
- **Should `Skills System` be split into smaller, more focused modules?**
  _Cohesion score 0.0627027027027027 - nodes in this community are weakly interconnected._