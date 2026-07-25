import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { ToolModule } from '../types.js';
import { detectFileType } from '../file-detector.js';
import { readDocumentTool } from './read-document.js';

const DOC_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.rtf', '.csv', '.tsv', '.epub', '.html', '.htm',
]);

const DEFAULT_LINE_LIMIT = 500;
const MAX_BYTES_DEFAULT = 100_000;

export function formatLineNumbered(lines: string[], startLine = 1): string {
  const maxDigits = String(startLine + lines.length - 1).length;
  return lines
    .map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(maxDigits, ' ');
      return `  ${lineNum} │ ${line}`;
    })
    .join('\n');
}

export const readFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read-file',
      description: 'Read the contents of a file at the given path with line numbers. Efficiently reads text files, code, PDFs, Word docs (.docx), Excel spreadsheets (.xlsx, .csv), and presentations (.pptx).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          offset: {
            type: 'number',
            description: 'Line number offset (1-indexed) to start reading from (default: 1)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default: 500)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd, options) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const offset = typeof args.offset === 'number' ? Math.max(1, args.offset) : 1;
    const limit = typeof args.limit === 'number' ? Math.min(2000, Math.max(1, args.limit)) : DEFAULT_LINE_LIMIT;

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);
    const ext = extname(resolvedPath).toLowerCase();

    // Delegate rich document formats
    if (DOC_EXTENSIONS.has(ext)) {
      return await readDocumentTool.execute({ path: filePath }, cwd, options);
    }

    const fileInfo = detectFileType(resolvedPath);
    if (fileInfo.category === 'pdf') {
      return await readDocumentTool.execute({ path: filePath }, cwd, options);
    }

    if (fileInfo.category !== 'text') {
      return `[Binary file detected: ${fileInfo.category} (${fileInfo.mimeType}, ${fileInfo.sizeLabel})]\nCannot render raw binary file as text.`;
    }

    try {
      const fileStat = await stat(resolvedPath);
      if (fileStat.size > 2_000_000 && !args.limit && !args.offset) {
        // Large file optimization: read first chunk
        const content = await readFile(resolvedPath, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;
        const sliced = lines.slice(0, limit);
        const header = `[Large File: ${filePath} (${fileInfo.sizeLabel}) | Total lines: ${totalLines} | Showing first ${sliced.length} lines. Specify offset & limit for more]\n`;
        return header + formatLineNumbered(sliced, 1);
      }

      const content = await readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const startIndex = offset - 1;
      const endIndex = Math.min(totalLines, startIndex + limit);
      const sliced = lines.slice(startIndex, endIndex);

      const hasMore = endIndex < totalLines;
      const header = (hasMore || offset > 1)
        ? `[File: ${filePath} | Showing lines ${offset}–${endIndex} of ${totalLines}${hasMore ? ' (Use offset=' + (endIndex + 1) + ' to read further)' : ''}]\n`
        : `[File: ${filePath} | Total lines: ${totalLines}]\n`;

      return header + formatLineNumbered(sliced, offset);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file: ${message}`);
    }
  },
};
