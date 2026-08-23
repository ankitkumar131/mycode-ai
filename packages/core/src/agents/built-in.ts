import type { AgentInfo, Agent } from './types.js';
import { agentService } from './agent-service.js';

function info(
  overrides: Partial<AgentInfo> & { name: string; permission: any[] }
): AgentInfo {
  return {
    mode: 'primary',
    native: true,
    hidden: false,
    temperature: 0,
    options: {},
    description: '',
    ...overrides,
  };
}

export const buildInfo: AgentInfo = info({
  name: 'build',
  description: 'Full-stack application builder with write access. The default agent.',
  mode: 'primary',
  steps: 50,
  permission: [
    { permission: '*', pattern: '*', action: 'allow' },
    {
      permission: 'run_command',
      pattern: 'rm -rf *',
      action: 'ask',
      reason: 'Destructive',
    },
  ],
});

export const planInfo: AgentInfo = info({
  name: 'plan',
  description: 'Read-only code analysis and planning. Cannot modify files.',
  mode: 'primary',
  steps: 30,
  permission: [
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'read_file', pattern: '*', action: 'allow' },
    { permission: 'search_files', pattern: '*', action: 'allow' },
    { permission: 'url_fetch', pattern: '*', action: 'allow' },
    { permission: 'web_search', pattern: '*', action: 'allow' },
    { permission: 'read_instructions', pattern: '*', action: 'allow' },
    { permission: 'task', pattern: '*', action: 'allow' },
  ],
});

export const generalInfo: AgentInfo = info({
  name: 'general',
  description: 'General-purpose agent for researching complex questions and executing multi-step tasks.',
  mode: 'subagent',
  steps: 20,
  permission: [
    { permission: '*', pattern: '*', action: 'allow' },
    {
      permission: 'run_command',
      pattern: 'rm -rf *',
      action: 'ask',
      reason: 'Destructive',
    },
  ],
});

export const exploreInfo: AgentInfo = info({
  name: 'explore',
  description: 'Fast file search specialist. Reads and searches only — no modifications.',
  mode: 'subagent',
  steps: 8,
  permission: [
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'read_file', pattern: '*', action: 'allow' },
    { permission: 'search_files', pattern: '*', action: 'allow' },
    { permission: 'read_instructions', pattern: '*', action: 'allow' },
    { permission: 'url_fetch', pattern: '*', action: 'allow' },
    { permission: 'web_search', pattern: '*', action: 'allow' },
    { permission: 'task', pattern: '*', action: 'allow' },
  ],
});

export const compactionInfo: AgentInfo = info({
  name: 'compaction',
  description: 'Internal agent for context compaction.',
  hidden: true,
  mode: 'all',
  steps: 1,
  temperature: 0,
  permission: [{ permission: '*', pattern: '*', action: 'deny' }],
});

export const titleInfo: AgentInfo = info({
  name: 'title',
  description: 'Internal agent for conversation title generation.',
  hidden: true,
  mode: 'all',
  steps: 1,
  temperature: 0.5,
  permission: [{ permission: '*', pattern: '*', action: 'deny' }],
});

export const summaryInfo: AgentInfo = info({
  name: 'summary',
  description: 'Internal agent for session summary generation.',
  hidden: true,
  mode: 'all',
  steps: 1,
  temperature: 0,
  permission: [{ permission: '*', pattern: '*', action: 'deny' }],
});

export function registerBuiltInAgents(): void {
  for (const agentInfo of [
    buildInfo,
    planInfo,
    generalInfo,
    exploreInfo,
    compactionInfo,
    titleInfo,
    summaryInfo,
  ]) {
    agentService.register({
      info: agentInfo,
      generate: async (opts) => ({
        text: `Agent [${agentInfo.name}] executed prompt: "${opts.prompt}"`,
      }),
    });
  }
}
