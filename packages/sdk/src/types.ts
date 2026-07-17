export interface AgentConfig {
  model?: string;
  provider?: string;
  skills?: SkillConfig[];
  tools?: boolean;
}

export interface SkillConfig {
  name: string;
  path: string;
}
