// MyCode Core — Agent engine, tools, skills, MCP, and provider system

// Agent
export { AgentSession } from './agent/agent-session.js';
export type { SessionConfig, SessionUsage } from './agent/agent-session.js';
export { EventTranslator } from './agent/event-translator.js';

// Automatic intent routing and bounded multi-worker orchestration
export { TaskRouter, taskRouter, formatTaskPlanGuidance } from './orchestration/task-router.js';
export { TaskSupervisor } from './orchestration/task-supervisor.js';
export {
  runAutomaticPreflight,
  runAutomaticPostflight,
  formatAutomaticEvidence,
} from './orchestration/automatic-orchestrator.js';
export type { AutomaticOrchestrationRuntime, AutomaticEvidence } from './orchestration/automatic-orchestrator.js';
export type {
  OrchestrationMode,
  OrchestrationRequest,
  OrchestrationTaskKind,
  OrchestrationTaskStatus,
  OrchestrationTaskSpec,
  TaskPlan,
  TaskPlanner,
  TaskExecutionContext,
  TaskResult,
  TaskExecutor,
  OrchestrationRunResult,
  TaskSupervisorOptions,
} from './orchestration/types.js';
export { ConversationContext } from './agent/context.js';
export type { AgentOptions, AgentEvent, Message as AgentMessage } from './agent/types.js';

// Multi-Agent Engine
export { AgentService, agentService } from './agents/agent-service.js';
export { registerBuiltInAgents, buildInfo, planInfo, generalInfo, exploreInfo } from './agents/built-in.js';
export type { AgentInfo, AgentMode, Agent, GenerateOptions, GenerateResult } from './agents/types.js';

// Tools
export { ToolRegistry, TOOLSETS, ALIASES as TOOL_ALIASES } from './tools/tool-registry.js';
export { ProcessManager, processManager } from './tools/process-manager.js';
export type { ManagedProcess } from './tools/process-manager.js';
export { classifyCommand, isBlocked, getSafetyLabel } from './tools/command-safety.js';
export { CommandHistory } from './tools/command-history.js';
export { executeCommand } from './tools/command-executor.js';
export { detectFileType, isBinaryFile } from './tools/file-detector.js';
export type {
  ToolDefinition,
  ToolHandler,
  ToolModule,
  ToolCall,
  ToolResult,
  ToolFunctionDefinition,
  ToolExecuteOptions,
  SafetyLevel,
  SafetyResult,
  CommandRecord,
  ExecutionResult,
} from './tools/types.js';

// Tool definitions
export { readFileTool } from './tools/definitions/read-file.js';
export { writeFileTool } from './tools/definitions/write-file.js';
export { editFileTool } from './tools/definitions/edit-file.js';
export { listDirTool } from './tools/definitions/list-dir.js';
export { searchFilesTool } from './tools/definitions/search-files.js';
export { gitStatusTool } from './tools/definitions/git-status.js';
export { execCommandTool } from './tools/definitions/exec-command.js';
export { readPdfTool } from './tools/definitions/read-pdf.js';
export { readDocumentTool } from './tools/definitions/read-document.js';
export { fetchWebPageTool } from './tools/definitions/web-fetch.js';
export { webSearchTool } from './tools/definitions/web-search.js';
export { globSearchTool } from './tools/definitions/glob-search.js';
export { delegateTool } from './tools/definitions/delegate.js';
export { browserVerifyTool } from './tools/definitions/browser-verify.js';
export { decisionGateTool } from './tools/definitions/decision-gate.js';
export { sandboxTaskTool } from './tools/definitions/sandbox-task.js';
export { codeExecTool } from './tools/definitions/code-exec.js';
export { questionTool } from './tools/definitions/question.js';
export { todoWriteTool } from './tools/definitions/todowrite.js';
export { readInstructionsTool } from './tools/definitions/read-instructions.js';
export { processTool } from './tools/definitions/process.js';
export { skillsListTool, skillViewTool, skillManageTool } from './tools/definitions/skills.js';
export { memoryTool, readMemoryFile, writeMemoryFile, memoryPath } from './tools/definitions/memory.js';

// Documents
export { extractDocument, renderDocument, isDocumentFile, DOCUMENT_EXTENSIONS, htmlToText, rtfToText } from './documents/document-reader.js';
export type { ExtractedDocument, DocumentSection } from './documents/document-reader.js';
export { ZipReader } from './documents/zip.js';

// Sessions
export { SessionStore, sessionStore } from './sessions/session-store.js';
export type { SavedSession, SessionSummary } from './sessions/session-store.js';
export { RunLedger, runLedger } from './sessions/run-ledger.js';
export type { RunRecord, RunStatus } from './sessions/run-ledger.js';

// Skills
export { SkillLoader, parseFrontmatter, stripFrontmatter, isPlatformCompatible } from './skills/skill-loader.js';
export { BUNDLED_SKILLS } from './skills/bundled-skills.js';
export { SkillManager, skillManager } from './skills/skill-manager.js';
export type { SkillDefinition, InstalledSkill, SkillsLockFile, SkillFrontmatter, SkillIndexEntry } from './skills/types.js';
export type { SkillManagerOptions, SkillSearchResult } from './skills/skill-manager.js';

// Providers
export { BaseProvider } from './routing/base-provider.js';
export { ProviderRouter } from './routing/provider-router.js';
export { CliAgentProvider } from './routing/cli-agent-provider.js';
export type { ProviderConfig, ProviderStats } from './routing/types.js';

// Optional browser verification integration (Jev-compatible JSON bridge)
export { ExternalBrowserVerifier } from './integrations/browser-verifier.js';
export type {
  BrowserVerifier,
  BrowserVerifierConfig,
  BrowserVerificationRequest,
  BrowserVerificationResult,
} from './integrations/browser-verifier.js';
export { ExternalDecisionGate } from './integrations/decision-gate.js';
export type {
  DecisionGate,
  DecisionGateConfig,
  DecisionQuestion,
  DecisionQuestionType,
  DecisionRequest,
  DecisionResult,
} from './integrations/decision-gate.js';
export { AxCliSandboxBackend } from './integrations/sandbox-backend.js';
export type {
  SandboxBackend,
  SandboxBackendConfig,
  SandboxTaskRequest,
  SandboxTaskResult,
} from './integrations/sandbox-backend.js';

// Hooks
export { HookAggregator, HookRunner } from './hooks/hooks.js';
export type { HookDefinition, HookEvent } from './hooks/types.js';

// MCP
export { MCPClient, MCPClientManager, mcpManager } from './mcp/mcp-client.js';
export type { MCPConfig, MCPServerConfig, MCPToolInfo } from './mcp/types.js';

// Voice
export { VoiceEngine, voiceEngine } from './voice/voice-engine.js';
export type { VoiceConfig } from './voice/voice-engine.js';

// Context
export { ContextManager } from './context/context-manager.js';
export { FileContextResolver } from './context/file-resolver.js';

// Config
export { ConfigManager, adjustProviderPriorities } from './config/config-manager.js';
export type { MyCodeConfig } from './config/types.js';

// Output
export { OutputFormatter } from './output/output-formatter.js';
export type { OutputFormat } from './output/types.js';

// Prompts
export { SystemPromptBuilder, findContextFiles, readMemory, CONTEXT_FILE_NAMES } from './prompts/system-prompt.js';

// Native Ponytail policy
export {
  PONYTAIL_MOTTO,
  PONYTAIL_MODES,
  DEFAULT_PONYTAIL_MODE,
  DEFAULT_PONYTAIL_SETTINGS,
  getPonytailPolicy,
  buildPonytailCommandPrompt,
  normalizePonytailMode,
  ponytailModeDescription,
} from './policy/ponytail.js';
export type { PonytailMode, PonytailSettings, PonytailReviewKind } from './policy/ponytail.js';

// Safety & Policy
export { SafetyChecker } from './safety/safety-checker.js';
export { PolicyEngine } from './policy/policy-engine.js';
export { PermissionManager, permissionManager } from './policy/permission-manager.js';
export type { PermissionRule, RulesetArray, Effect, PermissionPromptRequest } from './policy/permission-manager.js';
export { ApprovalStore, approvalStore } from './policy/approval-store.js';
export type { ApprovalScope, ApprovalAction, ApprovalRecord } from './policy/approval-store.js';
