import chalk from 'chalk';
import readline from 'readline';
import { theme, heavyDivider, sectionHeader, frame } from './themes/theme.js';
import { skillManager } from '../../../core/src/skills/skill-manager.js';
import type { InstalledSkill } from '../../../core/src/skills/types.js';

export async function pickSkillInteractive(cwd: string): Promise<InstalledSkill | undefined> {
  const skills = skillManager.list(cwd);
  if (skills.length === 0) {
    console.log(`  ${chalk.hex(theme.amber)('No skills installed.')}`);
    return undefined;
  }

  console.log();
  console.log(sectionHeader('Installed Skills', { accent: 'green' }));
  console.log(`  ${chalk.hex(theme.dim)('Select a skill to inspect or inject into context:')}`);
  console.log();

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    console.log(
      `  ${chalk.hex(theme.amber)(`[${i + 1}]`)} ${chalk.hex(theme.green).bold(s.name.padEnd(20))} ${chalk.hex(theme.muted)(s.description || '(no description)')}`
    );
  }
  console.log();
  return skills[0];
}
