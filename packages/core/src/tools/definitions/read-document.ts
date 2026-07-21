/**
 * readDocument Tool — Native multi-format document reader.
 * Extracts text from PDF, Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx),
 * OpenDocument (.odt), Rich Text (.rtf), and HTML without needing external scripts.
 *
 * Saves LLM tokens by providing zero-overhead text extraction for complex document formats.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { inflateRawSync } from 'zlib';
import type { ToolModule } from '../types.js';
import { readPdfTool } from './read-pdf.js';

const MAX_DOCUMENT_CHARS = 100_000;

interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  offset: number;
}

function parseZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  let i = 0;

  while (i < buffer.length - 30) {
    if (buffer.readUInt32LE(i) === 0x04034b50) {
      const compressionMethod = buffer.readUInt16LE(i + 8);
      const compressedSize = buffer.readUInt32LE(i + 18);
      const uncompressedSize = buffer.readUInt32LE(i + 22);
      const fileNameLen = buffer.readUInt16LE(i + 26);
      const extraLen = buffer.readUInt16LE(i + 28);

      const filename = buffer.toString('utf8', i + 30, i + 30 + fileNameLen);
      const dataOffset = i + 30 + fileNameLen + extraLen;

      entries.set(filename, {
        filename,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        offset: dataOffset,
      });

      i = dataOffset + compressedSize;
    } else {
      i++;
    }
  }

  return entries;
}

function extractZipFileText(buffer: Buffer, filename: string): string | null {
  const entries = parseZipEntries(buffer);
  const entry = entries.get(filename);
  if (!entry) return null;

  const rawData = buffer.subarray(entry.offset, entry.offset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return rawData.toString('utf8');
  } else if (entry.compressionMethod === 8) {
    try {
      const decompressed = inflateRawSync(rawData);
      return decompressed.toString('utf8');
    } catch {
      return null;
    }
  }

  return null;
}

function extractDocx(buffer: Buffer): string {
  const xml = extractZipFileText(buffer, 'word/document.xml');
  if (!xml) return 'Error: Unable to extract word/document.xml from .docx';

  const withLines = xml
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:tab\/>/gi, '\t')
    .replace(/<w:br\/>/gi, '\n');

  const textMatches = withLines.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
  let text = textMatches
    .map(m => m.replace(/<[^>]+>/g, ''))
    .join('');

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractPptx(buffer: Buffer): string {
  const entries = parseZipEntries(buffer);
  const slideFiles = Array.from(entries.keys())
    .filter(k => k.startsWith('ppt/slides/slide') && k.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) return 'Error: No slides found in .pptx';

  const slidesText: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = extractZipFileText(buffer, slideFiles[i]);
    if (!xml) continue;

    const textMatches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
    const slideContent = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');

    if (slideContent.trim()) {
      slidesText.push(`--- Slide ${i + 1} ---\n${slideContent.trim()}`);
    }
  }

  return slidesText.join('\n\n');
}

function extractXlsx(buffer: Buffer): string {
  const sharedStringsXml = extractZipFileText(buffer, 'xl/sharedStrings.xml');
  const sharedStrings: string[] = [];

  if (sharedStringsXml) {
    const matches = sharedStringsXml.match(/<t[^>]*>([\s\S]*?)<\/t>/gi) || [];
    for (const m of matches) {
      sharedStrings.push(m.replace(/<[^>]+>/g, ''));
    }
  }

  const entries = parseZipEntries(buffer);
  const sheetFiles = Array.from(entries.keys())
    .filter(k => k.startsWith('xl/worksheets/sheet') && k.endsWith('.xml'))
    .sort();

  if (sheetFiles.length === 0) {
    return sharedStrings.length > 0
      ? `Shared Strings:\n${sharedStrings.join('\n')}`
      : 'Error: No worksheet data found in .xlsx';
  }

  const output: string[] = [];

  for (let s = 0; s < sheetFiles.length; s++) {
    const sheetXml = extractZipFileText(buffer, sheetFiles[s]);
    if (!sheetXml) continue;

    const rowMatches = sheetXml.match(/<row[^>]*>([\s\S]*?)<\/row>/gi) || [];
    const rows: string[] = [];

    for (const rowXml of rowMatches) {
      const cellMatches = rowXml.match(/<c[^>]*>([\s\S]*?)<\/c>/gi) || [];
      const cells: string[] = [];

      for (const cellXml of cellMatches) {
        const typeMatch = cellXml.match(/t="([^"]+)"/);
        const type = typeMatch ? typeMatch[1] : '';

        const valMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/i);
        const val = valMatch ? valMatch[1] : '';

        if (type === 's' && val) {
          const stringIndex = parseInt(val, 10);
          cells.push(sharedStrings[stringIndex] || val);
        } else if (val) {
          cells.push(val);
        }
      }

      if (cells.length > 0) {
        rows.push(cells.join('\t'));
      }
    }

    if (rows.length > 0) {
      output.push(`--- Sheet ${s + 1} ---\n${rows.join('\n')}`);
    }
  }

  return output.length > 0 ? output.join('\n\n') : sharedStrings.join('\n');
}

function extractOdt(buffer: Buffer): string {
  const xml = extractZipFileText(buffer, 'content.xml');
  if (!xml) return 'Error: Unable to extract content.xml from .odt';

  const withLines = xml.replace(/<\/text:p>/gi, '\n');
  const matches = withLines.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/gi) || [];
  return matches.map(m => m.replace(/<[^>]+>/g, '')).join('\n').trim();
}

function extractRtf(content: string): string {
  return content
    .replace(/\{\\fonttbl[\s\S]*?\}/gi, '')
    .replace(/\{\\colortbl[\s\S]*?\}/gi, '')
    .replace(/\\par[d]?\s?/gi, '\n')
    .replace(/\\tab\s?/gi, '\t')
    .replace(/\\[a-z]+\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHtml(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function extractCsv(content: string): string {
  const lines = content.split('\n').filter(Boolean);
  if (lines.length === 0) return '';
  return `CSV (${lines.length} rows):\n\n${content}`;
}

export const readDocumentTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'readDocument',
      description: 'Read and extract plain text from document files including PDF (.pdf), Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx), OpenDocument (.odt), Rich Text (.rtf), HTML (.html), and text files. Saves tokens by automatically parsing documents without writing extra scripts.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the document file (.pdf, .docx, .xlsx, .pptx, .odt, .rtf, .csv, .html, etc.)',
          },
          maxChars: {
            type: 'number',
            description: 'Optional maximum characters to return (default 100000)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd, options) {
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

    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : MAX_DOCUMENT_CHARS;
    const ext = extname(filePath).toLowerCase();

    let text = '';
    let formatLabel = ext.toUpperCase().slice(1);

    if (ext === '.pdf') {
      return await readPdfTool.execute({ path: filePath }, cwd, options);
    }

    const buffer = readFileSync(filePath);

    switch (ext) {
      case '.docx':
        text = extractDocx(buffer);
        formatLabel = 'Word Document (.docx)';
        break;
      case '.pptx':
        text = extractPptx(buffer);
        formatLabel = 'PowerPoint (.pptx)';
        break;
      case '.xlsx':
        text = extractXlsx(buffer);
        formatLabel = 'Excel Spreadsheet (.xlsx)';
        break;
      case '.odt':
        text = extractOdt(buffer);
        formatLabel = 'OpenDocument (.odt)';
        break;
      case '.rtf':
        text = extractRtf(buffer.toString('utf8'));
        formatLabel = 'Rich Text Format (.rtf)';
        break;
      case '.csv':
      case '.tsv':
        text = extractCsv(buffer.toString('utf8'));
        formatLabel = ext.toUpperCase().slice(1);
        break;
      case '.html':
      case '.htm':
        text = extractHtml(buffer.toString('utf8'));
        formatLabel = 'HTML Document';
        break;
      default:
        text = buffer.toString('utf8');
        formatLabel = ext ? `${ext} text` : 'Plain text';
        break;
    }

    const sizeKb = (stat.size / 1024).toFixed(1);
    const header = `File: ${basename(filePath)} (${formatLabel}, ${sizeKb} KB)\nLength: ${text.length} characters\n\n--- Document Content ---\n`;

    if (text.length > maxChars) {
      const truncated = text.slice(0, maxChars);
      return `${header}${truncated}\n\n... [Truncated: showing first ${maxChars} of ${text.length} characters]`;
    }

    return `${header}${text}`;
  },
};
