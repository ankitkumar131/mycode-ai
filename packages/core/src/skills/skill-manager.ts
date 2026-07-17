import { SkillLoader } from './skill-loader.js';
import type { SkillDefinition } from './types.js';

export class SkillManager {
  private skills: Map<string, SkillDefinition> = new Map();
  private loader: SkillLoader;

  constructor() {
    this.loader = new SkillLoader();
  }

  async reload(): Promise<void> {}

  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  enable(name: string): boolean {
    return true;
  }

  disable(name: string): boolean {
    return true;
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }
}
