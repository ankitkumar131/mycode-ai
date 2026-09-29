/**
 * Shared contracts for automatic task routing and multi-worker execution.
 *
 * The orchestration layer deliberately knows nothing about a particular
 * provider, browser runtime, or sandbox implementation. Jev, Laya, AX, and
 * the local MyCode runner plug into these contracts in later phases.
 */

export type OrchestrationMode =
  | 'native'
  | 'decision'
  | 'browser'
  | 'sandbox'
  | 'fix-and-verify'
  | 'parallel';

export type OrchestrationTaskKind =
  | 'native'
  | 'decision'
  | 'fixer'
  | 'browser-verifier'
  | 'sandbox-worker'
  | 'custom';

export type OrchestrationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface OrchestrationRequest {
  query: string;
  cwd: string;
  /** Optional context supplied by a caller such as the CLI or SDK. */
  context?: Record<string, unknown>;
}

export interface OrchestrationTaskSpec {
  id: string;
  kind: OrchestrationTaskKind;
  title: string;
  prompt: string;
  /** Tasks are not started until all listed tasks have completed. */
  dependsOn?: string[];
  /** A read-only task may inspect artifacts but must not mutate the workspace. */
  readOnly?: boolean;
  /** Capabilities the selected backend must provide. */
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskPlan {
  id: string;
  mode: OrchestrationMode;
  reason: string;
  confidence: number;
  tasks: OrchestrationTaskSpec[];
  /** Tool or adapter names that would satisfy the plan when configured. */
  recommendedTools: string[];
  createdAt: string;
}

export interface TaskPlanner {
  plan(request: OrchestrationRequest): TaskPlan;
}

export interface TaskExecutionContext {
  plan: TaskPlan;
  cwd: string;
  signal: AbortSignal;
  results: ReadonlyMap<string, TaskResult>;
}

export interface TaskResult {
  taskId: string;
  status: Exclude<OrchestrationTaskStatus, 'pending' | 'running'>;
  summary: string;
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
  artifacts?: Record<string, unknown>;
}

export type TaskExecutor = (
  task: OrchestrationTaskSpec,
  context: TaskExecutionContext,
) => Promise<Omit<TaskResult, 'taskId' | 'startedAt' | 'finishedAt'>>;

export interface OrchestrationRunResult {
  plan: TaskPlan;
  status: 'completed' | 'failed' | 'partial' | 'aborted';
  results: TaskResult[];
  startedAt: string;
  finishedAt: string;
}

export interface TaskSupervisorOptions {
  maxConcurrency?: number;
  onTaskStart?: (task: OrchestrationTaskSpec) => void;
  onTaskFinish?: (result: TaskResult) => void;
}
