/**
 * delegate — Agency-Agents + general sub-agent delegation
 * Enhanced to support specialized agents and general exploration
 */

import { agentService } from '../../agents/agent-service.js';
import type { ToolModule } from '../types.js';
import { findBestAgentForTask, getSpecializedAgent } from '../../agents/specialized/index.js';

export const delegateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'delegate',
      description: "Delegate self-contained subtask to focused subagent. Types: 'explore' (read-only search), 'general' (multi-step with writes), or specialized agent name (backend-architect, frontend-developer, etc.). Use 'auto' for intelligent routing.",
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Self-contained subtask description with context and goals' },
          agent: { type: 'string', description: "Subagent: 'explore', 'general', 'auto', or specialist name (backend-architect, frontend-developer, security-engineer, devops-engineer, performance-engineer, test-engineer, code-reviewer, debugger, browser-automation, memory-keeper)" },
        },
        required: ['task'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, cwd: string) => {
    const agentName = typeof args.agent === 'string' ? args.agent : 'explore';
    const task = typeof args.task === 'string' ? args.task : '';

    if (!task) throw new Error('Task required');

    // Specialized agent routing
    if (agentName !== 'explore' && agentName !== 'general') {
      let specialist;
      if (agentName === 'auto') {
        specialist = findBestAgentForTask(task);
      } else {
        specialist = getSpecializedAgent(agentName);
      }

      if (specialist) {
        // Return specialist execution plan
        // In full impl, would spawn child AgentSession with specialist system prompt
        return `Delegating to ${specialist.emoji} ${specialist.name} [${specialist.category}]:\n\nTask: ${task}\nCWD: ${cwd}\n\nSpecialist prompt:\n${specialist.systemPrompt.slice(0, 800)}...\n\nTools: ${specialist.tools.join(', ')}\nSuccess criteria: ${specialist.successCriteria.join(' | ')}\n\nExecute following ${specialist.name} rules.`;
      }
    }

    const agent = agentService.get(agentName === 'auto' ? 'explore' : agentName);

    if (!agent) {
      // Fallback: list available specialists
      const { SPECIALIZED_AGENTS } = await import('../../agents/specialized/index.js');
      const available = SPECIALIZED_AGENTS.map(a => a.name).join(', ');
      return `Agent '${agentName}' not registered. Available: explore, general, auto, ${available}`;
    }

    try {
      const result = await agent.generate?.({ model: null, prompt: task });
      return {
        success: !result?.error,
        agent: agentName,
        summary: result?.text ?? `Subagent ${agentName} completed.`,
        error: result?.error,
      };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }) as unknown as ToolModule['execute'],
};
