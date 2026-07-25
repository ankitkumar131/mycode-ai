import { agentService } from '../../agents/agent-service.js';
import type { ToolModule } from '../types.js';

export const delegateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        "Delegate a self-contained subtask to a focused subagent ('explore' for read-only search, 'general' for multi-step task with file write).",
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
  execute: async (args: { task: string; agent?: string }) => {
    const targetAgentName = args.agent || 'explore';
    const agent = agentService.get(targetAgentName);

    if (!agent) {
      return {
        success: false,
        error: `Agent '${targetAgentName}' not registered.`,
      };
    }

    try {
      const result = await agent.generate?.({
        model: null,
        prompt: args.task,
      });

      return {
        success: !result?.error,
        agent: targetAgentName,
        summary: result?.text ?? `Subagent ${targetAgentName} completed task.`,
        error: result?.error,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  },
};
