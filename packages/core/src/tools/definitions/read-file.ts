import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolModule } from '../types.js';

export const readFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read-file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          offset: {
            type: 'number',
            description: 'Line number offset (1-indexed) to start reading from',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const offset = typeof args.offset === 'number' ? args.offset : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : undefined;

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);

    try {
      const content = await readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');

      if (offset !== undefined || limit !== undefined) {
        const start = offset ? Math.max(0, offset - 1) : 0;
        const end = limit ? start + limit : undefined;
        const sliced = lines.slice(start, end);
        return sliced.join('\n');
      }

      return content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file: ${message}`);
    }
  },
};
