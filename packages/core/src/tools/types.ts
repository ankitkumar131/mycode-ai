export interface ToolFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecuteOptions {
  confirmFn?: (target: string, context?: string | null, safety?: SafetyResult) => Promise<boolean>;
  commandHistory?: {
    add(record: CommandRecord): void;
  };
  abortSignal?: AbortSignal;
}

export interface ToolModule {
  definition: ToolFunctionDefinition;
  execute: (args: Record<string, unknown>, cwd: string, options?: ToolExecuteOptions) => string | Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export type SafetyLevel = 'blocked' | 'dangerous' | 'elevated' | 'normal';

export interface SafetyResult {
  level: SafetyLevel;
  reason: string;
  warnings: string[];
}

export interface CommandRecord {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  status: 'success' | 'failed' | 'killed' | 'timeout' | 'cancelled';
  output?: string;
  outputPreview?: string;
  timestamp?: string;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  output: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  truncated: boolean;
  status: 'success' | 'failed' | 'killed' | 'timeout';
}
