import type { RulesetArray } from '../policy/permission-manager.js';

export type AgentMode = 'primary' | 'subagent' | 'all';

export interface AgentInfo {
  name: string;
  description: string;
  mode: AgentMode;
  native?: boolean;
  hidden?: boolean;
  steps?: number;
  temperature?: number;
  prompt?: string;
  permission: RulesetArray;
  options?: Record<string, unknown>;
}

export interface GenerateOptions {
  model: any;
  tools?: any;
  prompt: string;
  budget?: number;
  onChunk?: (chunk: string) => void;
  onToolCall?: (params: { toolName: string; args?: unknown }) => void;
  parentAgent?: string;
}

export interface GenerateResult {
  text: string;
  filesRead?: string[];
  filesChanged?: string[];
  tokens?: number;
  finishReason?: string;
  error?: string;
}

export interface Agent {
  info: AgentInfo;
  generate?: (opts: GenerateOptions) => Promise<GenerateResult>;
}
