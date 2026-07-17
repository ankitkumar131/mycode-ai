export interface AgentOptions {
  model?: string;
  provider?: string;
  tools?: boolean;
  maxIterations?: number;
}

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'error'; message: string }
  | { type: 'finish'; usage?: { promptTokens: number; completionTokens: number } };
