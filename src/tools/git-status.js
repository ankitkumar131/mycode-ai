/**
 * Tool: Git Status
 * Provides git repository information — status, diff, recent log.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

export const gitStatusTool = {
  definition: {
    type: 'function',
    function: {
      name: 'gitStatus',
      description:
        'Get git repository information: current status, staged changes, recent commits, or diffs. ' +
        'Use this to understand what has changed in the project.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'diff', 'log', 'branch'],
            description:
              'What git info to retrieve: ' +
              '"status" for working tree status, ' +
              '"diff" for unstaged changes, ' +
              '"log" for recent commits, ' +
              '"branch" for current branch info.',
          },
        },
        required: ['action'],
      },
    },
  },

  /**
   * Execute the gitStatus tool.
   */
  execute(args, cwd) {
    const projectDir = resolve(cwd);

    // Check if this is a git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return 'Error: Not a git repository. Initialize with: git init';
    }

    try {
      switch (args.action) {
        case 'status': {
          const status = execSync('git status --short', {
            cwd: projectDir,
            encoding: 'utf-8',
          }).trim();

          const branch = execSync('git branch --show-current', {
            cwd: projectDir,
            encoding: 'utf-8',
          }).trim();

          if (!status) {
            return `Branch: ${branch}\nWorking tree clean — no changes.`;
          }
          return `Branch: ${branch}\n${'─'.repeat(40)}\n${status}`;
        }

        case 'diff': {
          const diff = execSync('git diff', {
            cwd: projectDir,
            encoding: 'utf-8',
          }).trim();

          if (!diff) {
            // Try staged diff
            const staged = execSync('git diff --cached', {
              cwd: projectDir,
              encoding: 'utf-8',
            }).trim();

            if (!staged) return 'No changes to show.';
            return `Staged changes:\n${'─'.repeat(40)}\n${staged.slice(0, 10_000)}`;
          }

          return `Unstaged changes:\n${'─'.repeat(40)}\n${diff.slice(0, 10_000)}`;
        }

        case 'log': {
          const log = execSync(
            'git log --oneline --no-decorate -n 15',
            { cwd: projectDir, encoding: 'utf-8' }
          ).trim();

          return `Recent commits:\n${'─'.repeat(40)}\n${log || 'No commits yet.'}`;
        }

        case 'branch': {
          const branches = execSync('git branch -a', {
            cwd: projectDir,
            encoding: 'utf-8',
          }).trim();

          return `Branches:\n${'─'.repeat(40)}\n${branches}`;
        }

        default:
          return `Unknown git action: "${args.action}". Use: status, diff, log, or branch.`;
      }
    } catch (err) {
      return `Git error: ${err.message}`;
    }
  },
};
