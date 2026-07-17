import type { SkillConfig } from './types.js';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export function skillDir(dirPath: string): SkillConfig {
  return { path: dirPath, name: basename(dirPath) || 'skill' };
}

export async function discoverSkills(dir: string): Promise<SkillConfig[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const skills: SkillConfig[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = join(dir, entry.name);
      const hasSkill = existsSync(join(skillPath, 'SKILL.md'))
        || existsSync(join(skillPath, 'skill.json'));
      if (hasSkill) {
        skills.push({ name: entry.name, path: skillPath });
      }
    }
  }

  return skills;
}

export async function createSkill(dir: string, name: string, description: string): Promise<SkillConfig> {
  const skillDir = join(dir, name);
  if (!existsSync(skillDir)) {
    await mkdir(skillDir, { recursive: true });
  }

  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    await writeFile(skillPath, [
      `# ${name}`,
      '',
      description,
      '',
      '## Usage',
      '',
      'Describe how this skill works.',
      '',
      '## Configuration',
      '',
      'No additional configuration required.',
    ].join('\n'), 'utf-8');
  }

  return { name, path: skillDir };
}

export async function loadSkillConfig(skillPath: string): Promise<{ name: string; description: string } | null> {
  const skillFile = join(skillPath, 'SKILL.md');
  if (!existsSync(skillFile)) return null;

  const content = await readFile(skillFile, 'utf-8');
  const lines = content.split('\n');
  const name = lines[0]?.replace(/^#\s+/, '').trim() || basename(skillPath);
  const description = lines.slice(2).find((l) => l.trim())?.trim() || '';

  return { name, description };
}
