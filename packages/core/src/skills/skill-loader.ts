import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { InstalledSkill } from './types.js';

function parseFrontmatter(content: string): { description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: '' };
  const fm = match[1];
  const descMatch = fm.match(/^description\s*:\s*(.+)$/m);
  return { description: descMatch ? descMatch[1].trim() : '' };
}

export class SkillLoader {
  loadFromDirectory(dirPath: string): InstalledSkill[] {
    if (!existsSync(dirPath)) return [];
    const results: InstalledSkill[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(dirPath, entry.name, 'SKILL.md');
          if (existsSync(skillPath)) {
            const content = readFileSync(skillPath, 'utf-8');
            const { description } = parseFrontmatter(content);
            results.push({
              name: entry.name,
              definition: {
                name: entry.name,
                source: 'local',
                sourceType: 'local',
                skillPath,
              },
              description,
              localPath: skillPath,
            });
          }
        }
      }
    } catch {
      // Return accumulated skills
    }

    return results;
  }
}
