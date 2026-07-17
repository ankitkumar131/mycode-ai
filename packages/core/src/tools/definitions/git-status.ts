import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolModule } from '../types.js';

export const gitStatusTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'git-status',
      description: 'Get the current git repository status including branch, changes, and recent commits',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the git repository (default: cwd)',
          },
          showCommits: {
            type: 'number',
            description: 'Number of recent commits to show (default: 10)',
          },
        },
      },
    },
  },

  async execute(args, cwd) {
    const repoPath = typeof args.path === 'string' ? resolve(cwd, args.path) : cwd;
    const showCommits = typeof args.showCommits === 'number' ? args.showCommits : 10;

    function git(...args: string[]): string {
      try {
        return execSync(`git ${args.join(' ')}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
        }).trim();
      } catch {
        return '';
      }
    }

    const branch = git('branch', '--show-current');
    const status = git('status', '--short');
    const log = git('log', `--oneline`, `-${showCommits}`, '--no-decorate');

    const parts: string[] = [];

    if (branch) {
      parts.push(`Branch: ${branch}`);
    }

    if (status) {
      parts.push(`\nChanges:\n${status}`);
    } else {
      parts.push('\nNo changes (clean working tree)');
    }

    if (log) {
      parts.push(`\nRecent commits:\n${log}`);
    }

    return parts.join('\n');
  },
};
