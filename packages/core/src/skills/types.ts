export interface SkillDefinition {
  name: string;
  source: string;
  sourceType: 'github' | 'local' | 'bundled' | 'workspace';
  skillPath: string;
  computedHash?: string;
}

/** Parsed SKILL.md frontmatter (agentskills.io compatible + mycode/hermes metadata). */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  platforms?: string[];
  tags?: string[];
  category?: string;
  /** Optional "argument-hint" shown in the slash menu, e.g. "<file> [notes]" */
  argumentHint?: string;
  /** Used when the skill is invoked with no arguments (frontmatter `default-args`) */
  defaultArgs?: string;
  /** Any other raw frontmatter keys */
  raw: Record<string, unknown>;
}

export interface InstalledSkill {
  name: string;
  definition: SkillDefinition;
  description: string;
  /** Absolute path to SKILL.md */
  localPath: string;
  /** Absolute path to the skill directory */
  dir: string;
  frontmatter: SkillFrontmatter;
  category?: string;
  tags: string[];
  version?: string;
  platforms?: string[];
  /** Where the skill was discovered */
  origin: 'user' | 'workspace' | 'bundled' | 'external';
  /** Additional files (references/, scripts/, templates/) relative to the skill dir */
  files: string[];
}

export interface SkillsLockFile {
  version: number;
  skills: Record<string, SkillDefinition>;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  origin: InstalledSkill['origin'];
}

export type SkillManageAction = 'create' | 'edit' | 'delete' | 'patch' | 'write_file' | 'delete_file';
