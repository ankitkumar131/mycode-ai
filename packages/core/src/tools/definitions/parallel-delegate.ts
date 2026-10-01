import type { DelegatedTaskInput, ToolModule, ToolExecuteOptions } from '../types.js';

export const parallelDelegateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'parallel_delegate',
      description: 'Run independent self-contained subtasks concurrently through bounded MyCode workers. Use only when tasks do not edit the same files or depend on one another.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Independent delegated tasks.',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'Self-contained task with context and expected result.' },
                agent: { type: 'string', enum: ['explore', 'general'], default: 'explore' },
              },
              required: ['task'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },

  async execute(args, _cwd, options?: ToolExecuteOptions) {
    const tasks = Array.isArray(args.tasks)
      ? args.tasks
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          task: typeof (item as Record<string, unknown>).task === 'string' ? String((item as Record<string, unknown>).task).trim() : '',
          agent: typeof (item as Record<string, unknown>).agent === 'string' ? String((item as Record<string, unknown>).agent) : 'explore',
        }))
        .filter(item => item.task) as DelegatedTaskInput[]
      : [];
    if (!tasks.length) throw new Error('parallel_delegate requires at least one task.');
    if (!options?.delegateParallel) {
      return JSON.stringify({ success: false, status: 'unavailable', summary: 'Parallel delegation runtime is not available.' }, null, 2);
    }
    return JSON.stringify(await options.delegateParallel(tasks), null, 2);
  },
};
