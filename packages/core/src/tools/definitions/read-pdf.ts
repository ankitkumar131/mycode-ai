/**
 * readPdfTool — Extract text content from PDF files
 * Built-in PDF reading capability inspired by Gemini CLI's multimodal features.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import type { ToolModule } from '../types.js';

const MAX_TEXT_LENGTH = 80_000;

async function extractPdfText(filePath: string): Promise<{ text: string; pages: number; info: Record<string, string> }> {
  const buffer = readFileSync(filePath);

  try {
    // Dynamic import to avoid hard dependency at compile time
    const pdfModule = await (import('pdf-parse' as any) as Promise<any>);
    const pdfParse = pdfModule.default || pdfModule;
    const data = await pdfParse(buffer);

    return {
      text: data.text || '',
      pages: data.numpages || 0,
      info: {
        title: data.info?.Title || '',
        author: data.info?.Author || '',
        creator: data.info?.Creator || '',
        pages: String(data.numpages || 0),
      },
    };
  } catch (err: any) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
      const stat = statSync(filePath);
      return {
        text: `[PDF file detected but pdf-parse is not installed. Install it with: npm install pdf-parse]\n\nFile: ${basename(filePath)}\nSize: ${(stat.size / 1024).toFixed(1)} KB`,
        pages: 0,
        info: { note: 'pdf-parse not installed' },
      };
    }
    throw err;
  }
}

export const readPdfTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'readPDF',
      description: 'Read and extract text content from a PDF file. Returns text with page numbers. Useful for reading PDF docs, manuals, research papers.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the PDF file',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd) {
    const pathArg = typeof args.path === 'string' ? args.path : '';
    if (!pathArg) throw new Error('Path is required');

    const filePath = resolve(cwd, pathArg);

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${pathArg}`);
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory: ${pathArg}`);
    }

    try {
      const { text, pages, info } = await extractPdfText(filePath);
      const parts: string[] = [];
      parts.push(`PDF: ${basename(filePath)}`);
      parts.push(`Pages: ${pages}`);

      if (info.title) parts.push(`Title: ${info.title}`);
      if (info.author) parts.push(`Author: ${info.author}`);

      parts.push('');
      parts.push('--- Content ---');

      let content = text;
      if (content.length > MAX_TEXT_LENGTH) {
        content = content.slice(0, MAX_TEXT_LENGTH);
        parts.push(content);
        parts.push(`\n... [Truncated: showing first ${MAX_TEXT_LENGTH} of ${text.length} chars]`);
      } else {
        parts.push(content);
      }

      return parts.join('\n');
    } catch (err: any) {
      throw new Error(`Failed to read PDF: ${err.message}`);
    }
  },
};
