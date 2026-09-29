import { agentService } from '../../agents/agent-service.js';
import { getPonytailPolicy, DEFAULT_PONYTAIL_MODE } from '../../policy/ponytail.js';
import type { ToolModule, ToolExecuteOptions } from '../types.js';

export const delegateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        "Delegate a self-contained subtask to a focused subagent ('explore' for read-only search, 'general' for multi-step task with file write). Delegated work inherits the active Ponytail policy.",
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Self-contained subtask description including context and goals.',
          },
          agent: {
            type: 'string',
            enum: ['explore', 'general'],
            default: 'explore',
            description: "Subagent type: 'explore' (read-only) or 'general' (write-capable).",
          },
        },
        required: ['task'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, _cwd: string, options?: ToolExecuteOptions) => {
    const targetAgentName = typeof args.agent === 'string' ? args.agent : 'explore';
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) throw new Error('Delegated task is required.');

    // AgentSession supplies this runtime so delegation uses the same provider,
    // workspace, approvals, and policy. The legacy AgentService fallback keeps
    // SDK users that register their own agents working.
    if (options?.delegate) {
      try {
        const summary = await options.delegate(task, targetAgentName);
        return {
          success: true,
          agent: targetAgentName,
          summary,
          ponytailMode: options.ponytailMode ?? DEFAULT_PONYTAIL_MODE,
        };
      } catch (err: any) {
        return {
          success: false,
          agent: targetAgentName,
          error: err?.message || String(err),
        };
      }
    }

    const agent = agentService.get(targetAgentName);
    if (!agent) {
      return {
        success: false,
        error: `Agent '${targetAgentName}' not registered.`,
      };
    }

    try {
      const policy = getPonytailPolicy(options?.ponytailMode ?? DEFAULT_PONYTAIL_MODE, true);
      const result = await agent.generate?.({
        model: null,
        prompt: `${policy}\n\nDelegated task:\n${task}`,
        parentAgent: 'build',
      });

      return {
        success: !result?.error,
        agent: targetAgentName,
        summary: result?.text ?? `Subagent ${targetAgentName} completed task.`,
        error: result?.error,
        ponytailMode: options?.ponytailMode ?? DEFAULT_PONYTAIL_MODE,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }) as unknown as ToolModule['execute'],
};
