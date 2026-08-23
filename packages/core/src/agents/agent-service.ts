import type { Agent, AgentInfo } from './types.js';

export class AgentService {
  private agents: Map<string, Agent> = new Map();

  register(agent: Agent): void {
    this.agents.set(agent.info.name, agent);
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  list(includeHidden = false): AgentInfo[] {
    return Array.from(this.agents.values())
      .map((a) => a.info)
      .filter((info) => includeHidden || !info.hidden);
  }
}

export const agentService = new AgentService();
