import type {
  OrchestrationRunResult,
  OrchestrationTaskSpec,
  TaskExecutionContext,
  TaskExecutor,
  TaskPlan,
  TaskResult,
  TaskSupervisorOptions,
} from './types.js';

function now(): string {
  return new Date().toISOString();
}

function failedDependency(task: OrchestrationTaskSpec, results: ReadonlyMap<string, TaskResult>): TaskResult | undefined {
  return (task.dependsOn ?? [])
    .map(id => results.get(id))
    .find(result => result && result.status !== 'completed');
}

/**
 * Bounded dependency-aware executor for local and remote task backends.
 *
 * Independent tasks run concurrently up to maxConcurrency. A dependent task
 * is only released after every dependency succeeds, so a verifier can never
 * inspect a failed or half-created fixer artifact.
 */
export class TaskSupervisor {
  private readonly maxConcurrency: number;
  private readonly options: TaskSupervisorOptions;

  constructor(options: TaskSupervisorOptions = {}) {
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 2));
    this.options = options;
  }

  async run(
    plan: TaskPlan,
    cwd: string,
    executor: TaskExecutor,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<OrchestrationRunResult> {
    const startedAt = now();
    const results = new Map<string, TaskResult>();
    const tasks = new Map(plan.tasks.map(task => [task.id, task]));
    const active = new Map<string, Promise<{ id: string; result: TaskResult }>>();

    if (tasks.size !== plan.tasks.length) {
      throw new Error('Orchestration plan contains duplicate task ids.');
    }
    for (const task of plan.tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!tasks.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task ${dependency}.`);
      }
    }

    const complete = (task: OrchestrationTaskSpec, result: TaskResult): void => {
      results.set(task.id, result);
      this.options.onTaskFinish?.(result);
    };

    const launch = (task: OrchestrationTaskSpec): void => {
      const started = now();
      this.options.onTaskStart?.(task);
      const promise = Promise.resolve()
        .then(async () => {
          if (signal.aborted) {
            return {
              taskId: task.id,
              status: 'cancelled' as const,
              summary: 'Task cancelled before execution.',
              startedAt: started,
              finishedAt: now(),
            };
          }
          try {
            const context: TaskExecutionContext = { plan, cwd, signal, results };
            const result = await executor(task, context);
            return {
              taskId: task.id,
              ...result,
              startedAt: started,
              finishedAt: now(),
            };
          } catch (error) {
            return {
              taskId: task.id,
              status: 'failed' as const,
              summary: 'Task executor failed.',
              error: error instanceof Error ? error.message : String(error),
              startedAt: started,
              finishedAt: now(),
            };
          }
        })
        .then(result => ({ id: task.id, result }));
      active.set(task.id, promise);
    };

    while (results.size < tasks.size) {
      if (signal.aborted) {
        for (const task of plan.tasks) {
          if (!results.has(task.id) && !active.has(task.id)) {
            complete(task, {
              taskId: task.id,
              status: 'cancelled',
              summary: 'Task cancelled before it became runnable.',
              startedAt: now(),
              finishedAt: now(),
            });
          }
        }
      }

      for (const task of plan.tasks) {
        if (results.has(task.id) || active.has(task.id)) continue;
        const dependency = failedDependency(task, results);
        if (dependency) {
          complete(task, {
            taskId: task.id,
            status: 'blocked',
            summary: `Blocked because dependency ${dependency.taskId} did not complete successfully.`,
            error: dependency.error,
            startedAt: now(),
            finishedAt: now(),
          });
          continue;
        }
        const dependencies = task.dependsOn ?? [];
        if (dependencies.every(id => results.get(id)?.status === 'completed')) {
          if (active.size < this.maxConcurrency && !signal.aborted) launch(task);
        }
      }

      if (active.size === 0) {
        if (results.size === tasks.size) break;
        const unresolved = plan.tasks.filter(task => !results.has(task.id)).map(task => task.id);
        throw new Error(`Orchestration plan has an unsatisfied dependency cycle: ${unresolved.join(', ')}`);
      }

      const completed = await Promise.race(active.values());
      active.delete(completed.id);
      complete(tasks.get(completed.id)!, completed.result);
    }

    const orderedResults = plan.tasks.map(task => results.get(task.id)!).filter(Boolean);
    const hasFailure = orderedResults.some(result => result.status === 'failed');
    const hasBlocked = orderedResults.some(result => result.status === 'blocked');
    const hasCancelled = orderedResults.some(result => result.status === 'cancelled');

    return {
      plan,
      status: hasCancelled || signal.aborted ? 'aborted' : hasFailure && hasBlocked ? 'partial' : hasFailure || hasBlocked ? 'failed' : 'completed',
      results: orderedResults,
      startedAt,
      finishedAt: now(),
    };
  }
}
