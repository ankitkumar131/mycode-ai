import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolModule } from '../types.js';
import { detectFileType } from '../file-detector.js';
import { readPdfTool } from './read-pdf.js';

export const readFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read-file',
      description: 'Read the contents of a file at the given path. Automatically handles text files, PDFs, and binary file warnings.',
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

  async execute(args, cwd, options) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const offset = typeof args.offset === 'number' ? args.offset : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : undefined;

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);

    // Detect file type first
    const fileInfo = detectFileType(resolvedPath);

    if (fileInfo.category === 'pdf') {
      // Auto-delegate to readPdfTool
      return await readPdfTool.execute({ path: filePath }, cwd, options);
    }

    if (fileInfo.category !== 'text') {
      return `[Binary file detected: ${fileInfo.category} (${fileInfo.mimeType}, ${fileInfo.sizeLabel})]\nCannot render raw binary file as text.`;
    }

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
