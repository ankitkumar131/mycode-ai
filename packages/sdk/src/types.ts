import type {
  AskUserQuestion,
  BaseProvider,
  FailoverEvent,
  MyCodeConfig,
  ProviderConfig,
  SafetyLevel,
  SafetyResult,
  ToolCall,
  ToolResult,
} from '@mycode/core';

export interface AgentConfig {
  /** Directory the agent works in. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit provider chain, in priority order. Wins over `provider`. */
  providers?: ProviderConfig[];
  /** A single provider: either a configured name or a full config object. */
  provider?: string | ProviderConfig;
  /** Model to use when the provider is resolved from the environment. */
  model?: string;
  /** Iteration cap per run. Defaults to 25. */
  maxIterations?: number;
  /** Set to false to run without tools (a plain chat). */
  tools?: boolean;
  /** Restrict the session to these toolsets: files, terminal, git, web, skills, agent. */
  toolsets?: string[];
  /** Extra system-prompt text, appended after the built-in sections. */
  systemPrompt?: string;
  /** Skills to advertise to the agent. Prefer `loadSkills()` to populate this. */
  skills?: SkillConfig[];
  /**
   * Approve every file write and shell command without asking.
   *
   * Off by default, and that default is deliberate: an embedded agent that
   * silently wrote files would be the single most surprising thing this API
   * could do. Either pass `confirm` (recommended — you decide per request) or
   * opt in here.
   */
  autoApprove?: boolean;
  /** Programmatic approval. Takes precedence over `autoApprove`. */
  confirm?: (request: ConfirmRequest) => boolean | Promise<boolean>;
  /** Bridge for the `question` tool. Without it the tool reports itself unavailable. */
  askUser?: (questions: AskUserQuestion[]) => Promise<Record<string, string>>;
  /**
   * Persist a checkpoint to `~/.mycode/sessions` when the session survives a
   * provider failover, so the work is recoverable. Default false.
   */
  persistSessions?: boolean;
  /**
   * Run the project formatter and type/lint diagnostics after a successful
   * write. Default true — it is what lets the agent see its own mistakes.
   */
  verify?: boolean;
}

export interface SkillConfig {
  name: string;
  path: string;
}

/** A tool contributed by the host. */
export interface ToolRegistration {
  /** Tool name the model will call. */
  name: string;
  description: string;
  /** JSON Schema for the arguments, e.g. `{ type: 'object', properties: {…} }`. */
  parameters: Record<string, unknown>;
  /**
   * Runs the tool. Return a string (or anything JSON-serialisable); a thrown
   * error is reported back to the model as a failed tool call rather than
   * aborting the run.
   */
  handler: (args: Record<string, unknown>) => string | Promise<string>;
}

/** A provider backend contributed by the host. */
export interface ProviderRegistration {
  /** Value of `apiProvider` in a provider config that routes here. */
  id: string;
  /** Builds the provider for a config. Usually `(cfg) => new MyProvider(cfg)`. */
  create: (config: ProviderConfig) => BaseProvider;
}

/** An approval request, for writes and shell commands. */
export interface ConfirmRequest {
  /** File path, or the shell command awaiting approval. */
  target: string;
  /** Diff summary for a write, description for a command. */
  context?: string | null;
  /** Safety classification. Present for shell commands, null for file writes. */
  safety?: SafetyResult | null;
}

export interface AgentEvents {
  /** Streamed assistant text. */
  onText?: (text: string) => void;
  /** Streamed reasoning/thinking text, when the provider exposes it. */
  onReasoning?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onError?: (error: Error) => void;
  /** Token usage for one model call. */
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
  /** The session switched providers (see `AgentConfig.providers`). */
  onFailover?: (event: FailoverEvent) => void;
  /** The context was compacted to fit the active provider's window. */
  onCompress?: (info: { before: number; after: number; pruned?: number }) => void;
  /** The run finished. Receives the final text, same as the `run()` return value. */
  onFinish?: (result: string) => void;
}

export interface RunOptions {
  /** Abort the run. The session stops at the next boundary and returns "Interrupted.". */
  signal?: AbortSignal;
  events?: AgentEvents;
  /** Overrides `AgentConfig.maxIterations` for this run onward. */
  maxIterations?: number;
}

export interface AgentInfo {
  version: string;
  model: string;
  provider: string;
  tools: number;
  skills: number;
  uptime: number;
  /** Session id once a run has started; null before that. */
  sessionId: string | null;
}

export type { MyCodeConfig, ProviderConfig, SafetyLevel, ToolCall, ToolResult };
