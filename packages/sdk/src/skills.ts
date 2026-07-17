import type { SkillConfig } from './types.js';

export function skillDir(dirPath: string): SkillConfig {
  return { path: dirPath, name: dirPath.split('/').pop() || 'skill' };
}
