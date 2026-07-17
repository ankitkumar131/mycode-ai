import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ToolModule } from '../types.js';

export const writeFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'write-file',
      description: 'Write content to a file at the given path (creates directories if needed)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },

  async execute(args, cwd) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);
    const dir = dirname(resolvedPath);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(resolvedPath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write file: ${message}`);
    }
  },
};
