/**
 * read_pdf — Convenience alias of read_document specialised for PDFs.
 * Kept as a distinct tool so models that "know" a PDF tool find it.
 */

import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import type { ToolModule } from '../types.js';
import { extractDocument, renderDocument } from '../../documents/document-reader.js';

const MAX_TEXT_LENGTH = 80_000;

export const readPdfTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read_pdf',
      description: 'Read and extract text from a PDF file, page by page. Supports page selection and offsets for long documents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the PDF file' },
          page: { type: 'number', description: 'Return only this 1-based page' },
          offset: { type: 'number', description: 'Character offset to continue from' },
          maxChars: { type: 'number', description: 'Maximum characters to return (default 80000)' },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd) {
    const pathArg = typeof args.path === 'string' ? args.path : '';
    if (!pathArg) throw new Error('Path is required');
    const filePath = resolve(cwd, pathArg);
    if (!existsSync(filePath)) throw new Error(`File not found: ${pathArg}`);
    if (statSync(filePath).isDirectory()) throw new Error(`Path is a directory: ${pathArg}`);

    try {
      const doc = await extractDocument(filePath);
      return renderDocument(doc, {
        page: typeof args.page === 'number' ? args.page : undefined,
        offset: typeof args.offset === 'number' ? args.offset : undefined,
        maxChars: typeof args.maxChars === 'number' ? args.maxChars : MAX_TEXT_LENGTH,
      });
    } catch (err: any) {
      throw new Error(`Failed to read PDF: ${err.message}`);
    }
  },
};
