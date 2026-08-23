import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolModule } from '../types.js';

export const listDirTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'list-dir',
      description: 'List files and directories in a given path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the directory',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum depth to recurse (default: 1, 0 = no recursion)',
          },
          showHidden: {
            type: 'boolean',
            description: 'Show hidden files (dotfiles, default: false)',
          },
          pattern: {
            type: 'string',
            description: 'Glob pattern to filter files',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd) {
    const dirPath = typeof args.path === 'string' ? args.path : '.';
    const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 1;
    const showHidden = args.showHidden === true;
    const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;

    if (!dirPath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, dirPath);

    async function list(dir: string, depth: number): Promise<string[]> {
      const entries: string[] = [];
      let names: string[];

      try {
        names = await readdir(dir);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to list directory: ${message}`);
      }

      names.sort((a, b) => a.localeCompare(b));

      for (const name of names) {
        if (!showHidden && name.startsWith('.')) continue;

        if (pattern && !name.includes(pattern.replace('*', ''))) continue;

        const fullPath = resolve(dir, name);
        let isDir = false;
        let size = 0;

        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          size = stats.size;
        } catch {
          // skip entries we cannot stat
          continue;
        }

        const relativePath = fullPath.slice(resolvedPath.length + 1).replace(/\\/g, '/');
        const sizeStr = isDir ? '' : ` (${formatSize(size)})`;
        entries.push(`${relativePath}${isDir ? '/' : ''}${sizeStr}`);

        if (isDir && depth < maxDepth) {
          const sub = await list(fullPath, depth + 1);
          entries.push(...sub.map(e => `  ${e}`));
        }
      }

      return entries;
    }

    const entries = await list(resolvedPath, 0);
    return entries.join('\n');
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
