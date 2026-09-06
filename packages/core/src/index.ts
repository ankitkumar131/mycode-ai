// MyCode Core — Agent engine, tools, skills, MCP, and provider system

// Agent
export { AgentSession } from './agent/agent-session.js';
export type { SessionConfig, SessionUsage } from './agent/agent-session.js';
export { EventTranslator } from './agent/event-translator.js';
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

// Skills
export { SkillLoader, parseFrontmatter, stripFrontmatter, isPlatformCompatible } from './skills/skill-loader.js';
export { BUNDLED_SKILLS } from './skills/bundled-skills.js';
export { SkillManager, skillManager } from './skills/skill-manager.js';
export type { SkillDefinition, InstalledSkill, SkillsLockFile, SkillFrontmatter, SkillIndexEntry } from './skills/types.js';
export type { SkillManagerOptions, SkillSearchResult } from './skills/skill-manager.js';

// Providers
export { BaseProvider } from './routing/base-provider.js';
export { ProviderRouter } from './routing/provider-router.js';
export type { ProviderConfig, ProviderStats } from './routing/types.js';

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

// Safety & Policy
export { SafetyChecker } from './safety/safety-checker.js';
export { PolicyEngine } from './policy/policy-engine.js';
export { PermissionManager, permissionManager } from './policy/permission-manager.js';
export type { PermissionRule, RulesetArray, Effect, PermissionPromptRequest } from './policy/permission-manager.js';
