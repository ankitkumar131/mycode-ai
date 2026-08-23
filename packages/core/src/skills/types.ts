export interface SkillDefinition {
  name: string;
  source: string;
  sourceType: 'github' | 'local';
  skillPath: string;
  computedHash?: string;
}

export interface InstalledSkill {
  name: string;
  definition: SkillDefinition;
  description: string;
  localPath: string;
}

export interface SkillsLockFile {
  version: number;
  skills: Record<string, SkillDefinition>;
}
