export interface SkillDefinition {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  tools?: Record<string, unknown>;
}
