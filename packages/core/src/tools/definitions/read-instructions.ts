import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ToolModule } from '../types.js';

export const readInstructionsTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read_instructions',
      description: 'Read workspace instruction file (MYCODE.md, CLAUDE.md, or AGENTS.md).',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Filename to read (default: MYCODE.md).',
          },
        },
      },
    },
  },
  execute: (async (args: Record<string, unknown>, cwd: string) => {
    const requested = typeof args.file === 'string' ? args.file : '';
    const candidates = requested ? [requested] : ['MYCODE.md', 'mycode.md', 'CLAUDE.md', 'AGENTS.md'];

    for (const name of candidates) {
      const fullPath = join(cwd, name);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        return {
          success: true,
          file: name,
          content,
        };
      }
    }

    return {
      success: false,
      error: 'No instruction files found in workspace.',
    };
  }) as unknown as ToolModule['execute'],
};
