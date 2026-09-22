/**
 * Enhanced Delegate Tool — Agency-Agents inspired
 * Delegates task to specialized sub-agent with full context
 * Each agent has distinct personality, mission, rules, deliverables
 * 
 * Inspired by msitarzewski/agency-agents
 */

import type { ToolModule } from '../types.js';
import { getSpecializedAgent, findBestAgentForTask, listSpecializedAgents, SPECIALIZED_AGENTS } from '../../agents/specialized/index.js';
import { memoryManager } from '../../memory/memory-manager.js';

export const delegateToSpecialistTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'delegate_to_specialist',
      description: `Delegate task to specialized AI sub-agent (Agency-Agents pattern). Each specialist has unique expertise, personality, and deliverables. Use for complex tasks needing domain expertise. Returns specialist's output. Agents: backend-architect, frontend-developer, security-engineer, devops-engineer, performance-engineer, test-engineer, code-reviewer, debugger, browser-automation, memory-keeper.`,
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Agent name or \"auto\" for auto-routing. Options: backend-architect, frontend-developer, security-engineer, devops-engineer, performance-engineer, test-engineer, code-reviewer, debugger, browser-automation, memory-keeper, auto' },
          task: { type: 'string', description: 'Task to delegate (detailed description)' },
          context: { type: 'string', description: 'Additional context, files, or constraints' },
        },
        required: ['task'],
      },
    },
  },
  async execute(args, cwd) {
    const agentName = typeof args.agent === 'string' ? args.agent : 'auto';
    const task = typeof args.task === 'string' ? args.task : '';
    const context = typeof args.context === 'string' ? args.context : '';
    
    if (!task) throw new Error('Task required');

    let specialist;
    if (agentName === 'auto') {
      specialist = findBestAgentForTask(task);
    } else {
      specialist = getSpecializedAgent(agentName);
      if (!specialist) {
        const available = SPECIALIZED_AGENTS.map(a => a.name).join(', ');
        throw new Error(`Unknown agent \"${agentName}\". Available: ${available}, auto`);
      }
    }

    // Build specialist prompt with memory context
    const memories = memoryManager.search(task, cwd, 3, 1000);
    const memoryContext = memories.length ? `\nRelevant memories:\n${memories.map(m => `- ${m.content}`).join('\n')}\n` : '';

    const prompt = `You are ${specialist.name} ${specialist.emoji} — ${specialist.description}

${specialist.systemPrompt}

Task: ${task}
${context ? `Context: ${context}` : ''}
${memoryContext}
Working directory: ${cwd}
Available tools: ${specialist.tools.join(', ')}

Execute this task following your specialty rules. Provide deliverables that meet your success criteria:
${specialist.successCriteria.map(c => `- ${c}`).join('\n')}

Be concise but thorough. Focus on your domain expertise.`;

    // For now, return the structured delegation plan
    // In full implementation, this would spawn sub-agent loop
    return `Delegating to ${specialist.emoji} ${specialist.name} (${specialist.category}):

Task: ${task}
${context ? `Context: ${context}` : ''}
Memory: ${memories.length} relevant memories found

Specialist prompt:
${prompt.slice(0, 1000)}...

Agent would execute with tools: ${specialist.tools.join(', ')}

To implement full sub-agent loop, integrate with agent-session.ts to spawn child agent with this system prompt.

For now, execute manually following ${specialist.name} rules:
${specialist.successCriteria.map((c, i) => `${i+1}. ${c}`).join('\n')}`;
  },
};

export const listSpecialistsTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'list_specialists',
      description: 'List all available specialized AI agents (Agency-Agents). Shows expertise, category, success criteria.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['engineering', 'design', 'product', 'marketing', 'operations', 'security', 'data', 'specialized', 'all'], description: 'Filter by category' },
        },
        required: [],
      },
    },
  },
  async execute(args) {
    const category = typeof args.category === 'string' ? args.category : 'all';
    
    let agents = listSpecializedAgents();
    if (category !== 'all') {
      agents = agents.filter(a => a.category === category);
    }

    const lines = [`Specialized Agents — ${agents.length} available (${category}):`, ''];
    
    for (const agent of agents) {
      lines.push(`${agent.emoji} ${agent.name} [${agent.category}]`);
      lines.push(`  ${agent.description}`);
      lines.push(`  Tools: ${agent.tools.slice(0, 5).join(', ')}${agent.tools.length > 5 ? '...' : ''}`);
      lines.push(`  Success: ${agent.successCriteria.slice(0, 2).join(' | ')}`);
      lines.push('');
    }

    lines.push('Usage: delegate_to_specialist agent=<name|auto> task="detailed task"');
    return lines.join('\n');
  },
};

export const specializedAgentTools = [delegateToSpecialistTool, listSpecialistsTool];
