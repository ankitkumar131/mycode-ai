import type { SkillDefinition } from './types.js';

export class SkillLoader {
  async loadFromDirectory(dirPath: string): Promise<SkillDefinition[]> {
    return [];
  }

  async loadSkill(skillPath: string): Promise<SkillDefinition | null> {
    return null;
  }
}
