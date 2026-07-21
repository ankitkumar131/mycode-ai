/**
 * globSearchTool — Find files matching glob patterns
 */

import { glob } from 'glob';
import type { ToolModule } from '../types.js';

export const globSearchTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'globSearch',
      description: 'Find files matching glob patterns (e.g. "**/*.ts", "src/**/*.js"). Fast way to discover files by extension or directory pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files',
          },
          ignore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Patterns to ignore',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args, cwd) {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    if (!pattern) throw new Error('Pattern is required');

    const ignoreInput = Array.isArray(args.ignore) ? (args.ignore as string[]) : [];

    const defaultIgnore = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
    ];

    const ignore = [...defaultIgnore, ...ignoreInput];

    try {
      const files = await glob(pattern, {
        cwd,
        ignore,
        nodir: true,
        dot: false,
      });

      if (files.length === 0) {
        return `No files matched pattern: "${pattern}"`;
      }

      const maxFiles = 200;
      const truncated = files.length > maxFiles;
      const displayFiles = files.slice(0, maxFiles);

      const result = [
        `Found ${files.length} file(s) matching "${pattern}":`,
        ...displayFiles.map((f) => `- ${f}`),
      ];

      if (truncated) {
        result.push(`... and ${files.length - maxFiles} more files (truncated)`);
      }

      return result.join('\n');
    } catch (err: any) {
      throw new Error(`Glob search failed: ${err.message}`);
    }
  },
};
