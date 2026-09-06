/**
 * read_document — Native multi-format document reader.
 * PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, RTF, HTML, CSV/TSV, Jupyter…
 * Zero external binaries; see core/documents/document-reader.ts.
 */

import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import type { ToolModule } from '../types.js';
import { extractDocument, renderDocument } from '../../documents/document-reader.js';

const MAX_DOCUMENT_CHARS = 100_000;

export const readDocumentTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read_document',
      description:
        'Extract text from documents: PDF (.pdf), Word (.docx/.doc), Excel (.xlsx/.xls/.csv/.tsv), PowerPoint (.pptx/.ppt), OpenDocument (.odt/.ods/.odp), EPUB, RTF, HTML and Jupyter notebooks. Returns page/slide/sheet-labelled text. Supports paging via page/offset. NEVER write scripts to parse documents — use this tool.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the document file' },
          page: { type: 'number', description: 'Return only this 1-based page/slide/sheet' },
          offset: { type: 'number', description: 'Character offset to start from (for long documents)' },
          maxChars: { type: 'number', description: 'Maximum characters to return (default 100000)' },
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

    const doc = await extractDocument(filePath);
    return renderDocument(doc, {
      page: typeof args.page === 'number' ? args.page : undefined,
      offset: typeof args.offset === 'number' ? args.offset : undefined,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : MAX_DOCUMENT_CHARS,
    });
  },
};
