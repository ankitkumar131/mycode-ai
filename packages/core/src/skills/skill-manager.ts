import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SkillLoader } from './skill-loader.js';
import type { InstalledSkill, SkillDefinition, SkillsLockFile } from './types.js';

export class SkillManager {
  private loader: SkillLoader;

  constructor() {
    this.loader = new SkillLoader();
  }

  getSkillsDir(): string {
    return join(homedir(), '.mycode', 'skills');
  }

  getLockFilePath(): string {
    return join(homedir(), '.mycode', 'skills-lock.json');
  }

  readLockFile(): SkillsLockFile {
    const lockPath = this.getLockFilePath();
    if (!existsSync(lockPath)) {
      return { version: 1, skills: {} };
    }
    try {
      return JSON.parse(readFileSync(lockPath, 'utf-8'));
    } catch {
      return { version: 1, skills: {} };
    }
  }

  writeLockFile(lock: SkillsLockFile): void {
    const lockPath = this.getLockFilePath();
    const dir = join(homedir(), '.mycode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
  }

  list(workspaceRoot?: string): InstalledSkill[] {
    const skills: InstalledSkill[] = [];
    const seen = new Set<string>();

    // 1. Installed in ~/.mycode/skills
    const userSkillsDir = this.getSkillsDir();
    const userSkills = this.loader.loadFromDirectory(userSkillsDir);
    for (const s of userSkills) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        skills.push(s);
      }
    }

    // 2. Workspace .agents/skills or skills/
    if (workspaceRoot) {
      const agentsSkills = join(workspaceRoot, '.agents', 'skills');
      for (const s of this.loader.loadFromDirectory(agentsSkills)) {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          skills.push(s);
        }
      }

      const rootSkills = join(workspaceRoot, 'skills');
      for (const s of this.loader.loadFromDirectory(rootSkills)) {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          skills.push(s);
        }
      }
    }

    return skills;
  }

  async addSkill(name: string, source: string, skillPath?: string): Promise<void> {
    const skillsDir = this.getSkillsDir();
    const targetDir = join(skillsDir, name);
    const targetFile = join(targetDir, 'SKILL.md');

    const resolvedPath = skillPath || `skills/${name}/SKILL.md`;
    const url = `https://raw.githubusercontent.com/${source}/main/${resolvedPath}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to download skill from ${url} (HTTP ${resp.status})`);
    }

    const content = await resp.text();

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    writeFileSync(targetFile, content, 'utf-8');

    const lock = this.readLockFile();
    lock.skills[name] = {
      name,
      source,
      sourceType: 'github',
      skillPath: resolvedPath,
    };
    this.writeLockFile(lock);
  }

  removeSkill(name: string): void {
    const skillsDir = this.getSkillsDir();
    const targetDir = join(skillsDir, name);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    const lock = this.readLockFile();
    delete lock.skills[name];
    this.writeLockFile(lock);
  }

  getSkillContent(skill: InstalledSkill): string {
    if (!existsSync(skill.localPath)) return '';
    const content = readFileSync(skill.localPath, 'utf-8');
    return content.split('\n').filter(l => !l.startsWith('---')).join('\n').trim();
  }
}

export const skillManager = new SkillManager();
