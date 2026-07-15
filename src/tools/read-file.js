/**
 * Tool: Read File
 * Reads a file's contents and returns them with line numbers.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, relative } from 'path';

export const readFileTool = {
  definition: {
    type: 'function',
    function: {
      name: 'readFile',
      description:
        'Read the contents of a file. Returns the file content with line numbers. ' +
        'Use this to understand existing code before making changes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute path to the file to read.',
          },
          startLine: {
            type: 'integer',
            description: 'Optional. Start reading from this line number (1-indexed).',
          },
          endLine: {
            type: 'integer',
            description: 'Optional. Stop reading at this line number (1-indexed, inclusive).',
          },
        },
        required: ['path'],
      },
    },
  },

  /**
   * Execute the readFile tool.
   * @param {object} args - { path, startLine?, endLine? }
   * @param {string} cwd - Current working directory
   * @returns {string} File contents with line numbers
   */
  execute(args, cwd) {
    const filePath = resolve(cwd, args.path);

    if (!existsSync(filePath)) {
      return `Error: File not found: ${args.path}`;
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return `Error: "${args.path}" is a directory, not a file. Use listDirectory instead.`;
    }

    // Check file size — refuse very large files
    if (stat.size > 1_000_000) {
      return `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use startLine/endLine to read a portion.`;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const start = Math.max(1, args.startLine || 1);
      const end = Math.min(lines.length, args.endLine || lines.length);

      const numbered = lines
        .slice(start - 1, end)
        .map((line, idx) => `${String(start + idx).padStart(4)} │ ${line}`)
        .join('\n');

      const relPath = relative(cwd, filePath);
      const header = `File: ${relPath} (lines ${start}-${end} of ${lines.length})`;

      return `${header}\n${'─'.repeat(60)}\n${numbered}`;
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  },
};
