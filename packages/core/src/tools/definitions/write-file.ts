import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ToolModule } from '../types.js';

const createdDirs = new Set<string>();

export const writeFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'write-file',
      description: 'Write content to a file at the given path. Creates parent directories if needed.',
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

  async execute(args, cwd, options) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);
    const dir = dirname(resolvedPath);

    if (options?.confirmFn) {
      const allowed = await options.confirmFn(filePath, `Write ${content.length} characters to ${filePath}`);
      if (!allowed) {
        throw new Error(`Write to ${filePath} was canceled by user.`);
      }
    }

    try {
      if (!createdDirs.has(dir)) {
        await mkdir(dir, { recursive: true });
        createdDirs.add(dir);
      }

      await writeFile(resolvedPath, content, 'utf-8');
      const lines = content.split('\n').length;
      return `✓ Successfully wrote ${lines} lines (${content.length} bytes) to ${filePath}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write file: ${message}`);
    }
  },
};
