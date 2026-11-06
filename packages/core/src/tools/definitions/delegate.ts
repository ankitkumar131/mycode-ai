import type { ToolModule } from '../types.js';
import { SUBAGENTS } from '../../agents/subagent.js';

/**
 * delegate — hand a self-contained subtask to a sub-agent with isolated context.
 *
 * The point is not "another agent"; it is that the child's transcript is thrown
 * away. An exploration that reads forty files burns tens of thousands of tokens
 * which, in the parent, would permanently crowd out the code being edited.
 *
 * Only the child's final report enters the parent context.
 */
export const delegateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        'Delegate a self-contained subtask to a sub-agent with its own isolated context. ' +
        "Use 'explore' to search and read without polluting your context (it cannot write files). " +
        "Use 'general' for an independent multi-step task that needs write access. " +
        "Only the sub-agent's written report comes back to you — its file reads do not.",
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'Self-contained subtask description. Include all context the sub-agent needs — it cannot see this conversation.',
          },
          agent: {
            type: 'string',
            enum: ['explore', 'general'],
            default: 'explore',
            description: "'explore' (read-only search) or 'general' (write-capable, multi-step).",
          },
        },
        required: ['task'],
      },
    },
  },
  execute: (async (
    args: Record<string, unknown>,
    _cwd: string,
    options?: {
      delegate?: (req: { kind: 'explore' | 'general'; task: string }) => Promise<string>;
    },
  ) => {
    const kind = args.agent === 'general' ? 'general' : 'explore';
    const task = typeof args.task === 'string' ? args.task.trim() : '';

    if (!task) return 'Error: delegate requires a non-empty `task` description.';

    if (!options?.delegate) {
      return (
        `Error: sub-agents are not available in this session. ` +
        `Perform the task directly instead — ${SUBAGENTS[kind].description}`
      );
    }

    try {
      return await options.delegate({ kind, task });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: sub-agent (${kind}) failed: ${msg}`;
    }
  }) as unknown as ToolModule['execute'],
};
