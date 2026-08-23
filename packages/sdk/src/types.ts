import type {
  ProviderConfig,
  MyCodeConfig,
  SafetyLevel,
  ToolCall,
  ToolResult,
} from '@mycode/core';

export interface AgentConfig {
  model?: string;
  provider?: string | ProviderConfig;
  providers?: ProviderConfig[];
  skills?: SkillConfig[];
  cwd?: string;
  maxIterations?: number;
  tools?: boolean;
  temperature?: number;
  systemPrompt?: string;
}

export interface SkillConfig {
  name: string;
  path: string;
}

export interface AgentEvents {
  onText?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onError?: (error: Error) => void;
  onFinish?: (result: string) => void;
}

export interface RunOptions {
  signal?: AbortSignal;
  events?: AgentEvents;
  maxIterations?: number;
}

export interface AgentInfo {
  version: string;
  model: string;
  provider: string;
  tools: number;
  skills: number;
  uptime: number;
}

export { type ProviderConfig, type MyCodeConfig, type SafetyLevel, type ToolCall, type ToolResult };
