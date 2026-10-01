import type { ToolModule, ToolExecuteOptions, SafetyResult } from '../types.js';

const sandboxAction: SafetyResult = {
  level: 'elevated',
  reason: 'Starting an isolated agent task consumes compute and may execute user-provided code.',
  warnings: ['The sandbox backend must enforce its own network, secret, CPU, and memory policy.'],
};

export const sandboxTaskTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'sandbox_task',
      description: 'Run a self-contained task through the configured sandbox backend (AX when configured). Use this for isolated or parallel workers; an unavailable backend is never treated as success.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Task goal and acceptance criteria.' },
          name: { type: 'string', description: 'Stable task name.' },
          command: { type: 'array', items: { type: 'string' }, description: 'Optional command argv to run in the sandbox.' },
          image: { type: 'string', description: 'Container image for AX execution.' },
          workspace: { type: 'string', description: 'Existing workspace name to bind.' },
          atespace: { type: 'string', description: 'AX atespace/namespace.' },
          read_only: { type: 'boolean', description: 'Whether the worker must remain read-only.' },
          debug: { type: 'boolean', description: 'Expose sandbox guest/debug services when supported.' },
          env: { type: 'object', description: 'Non-secret task environment variables.' },
        },
        required: ['goal'],
      },
    },
  },

  async execute(args, cwd, options?: ToolExecuteOptions) {
    if (!options?.sandboxBackend) {
      return JSON.stringify({
        success: false,
        status: 'unavailable',
        summary: 'No sandbox backend is configured.',
        error: 'Configure integrations.sandbox.command and an AX environment before requesting sandbox execution.',
      }, null, 2);
    }

    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    if (!goal) throw new Error('sandbox_task requires a goal.');
    const readOnly = args.read_only === true;
    if (!readOnly && options.confirmFn) {
      const allowed = await options.confirmFn(`sandbox task: ${goal.slice(0, 160)}`, goal, sandboxAction);
      if (!allowed) return JSON.stringify({ success: false, status: 'blocked', summary: 'Sandbox task was not approved.' }, null, 2);
    }

    const result = await options.sandboxBackend.runTask({
      goal,
      cwd,
      name: typeof args.name === 'string' ? args.name : undefined,
      command: Array.isArray(args.command) ? args.command.filter((item): item is string => typeof item === 'string') : undefined,
      image: typeof args.image === 'string' ? args.image : undefined,
      workspaceName: typeof args.workspace === 'string' ? args.workspace : undefined,
      atespace: typeof args.atespace === 'string' ? args.atespace : undefined,
      readOnly,
      debug: args.debug === true,
      env: args.env && typeof args.env === 'object' && !Array.isArray(args.env)
        ? Object.fromEntries(Object.entries(args.env).filter(([, value]) => typeof value === 'string'))
        : undefined,
    }, { signal: options.abortSignal });
    return JSON.stringify(result, null, 2);
  },
};
