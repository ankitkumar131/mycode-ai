import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { ToolModule } from '../types.js';
import { detectFileType } from '../file-detector.js';
import { readDocumentTool } from './read-document.js';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const DOC_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.rtf', '.csv', '.tsv', '.epub', '.html', '.htm',
]);

// Claude Code style: default 100 lines, token efficient
const DEFAULT_LINE_LIMIT = 100;
const MAX_LINE_LIMIT = 500;
const LARGE_FILE_THRESHOLD = 500_000; // 500KB
const MAX_FILE_SIZE_HARD = 5_000_000; // 5MB hard limit for direct read
const CACHE_MAX_SIZE = 20;
const CACHE_MAX_BYTES = 2_000_000;

// Simple LRU cache for file contents
interface CacheEntry {
  content: string;
  lines: string[];
  mtime: number;
  size: number;
}
const fileCache = new Map<string, CacheEntry>();

function getCached(path: string, mtime: number): CacheEntry | undefined {
  const entry = fileCache.get(path);
  if (entry && entry.mtime === mtime) {
    // Move to end (LRU)
    fileCache.delete(path);
    fileCache.set(path, entry);
    return entry;
  }
  return undefined;
}

function setCached(path: string, entry: CacheEntry) {
  if (fileCache.size >= CACHE_MAX_SIZE) {
    const firstKey = fileCache.keys().next().value;
    if (firstKey) fileCache.delete(firstKey);
  }
  // Evict if total bytes too large
  let total = entry.size;
  for (const e of fileCache.values()) total += e.size;
  while (total > CACHE_MAX_BYTES && fileCache.size > 0) {
    const firstKey = fileCache.keys().next().value;
    if (!firstKey) break;
    const evicted = fileCache.get(firstKey);
    if (evicted) total -= evicted.size;
    fileCache.delete(firstKey);
  }
  fileCache.set(path, entry);
}

export function formatLineNumbered(lines: string[], startLine = 1): string {
  const maxDigits = String(startLine + lines.length - 1).length;
  return lines
    .map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(maxDigits, ' ');
      return `${lineNum}│${line}`;
    })
    .join('\n');
}

// Extract outline: classes, functions, imports for quick overview
function extractOutline(lines: string[], filePath: string): string {
  const outline: string[] = [];
  const ext = extname(filePath).toLowerCase();
  const isCode = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb'].includes(ext);
  if (!isCode) return '';

  const patterns = [
    /^\s*(export\s+)?(class|interface|enum|type)\s+(\w+)/,
    /^\s*(export\s+)?(async\s+)?function\s+(\w+)/,
    /^\s*(export\s+)?const\s+(\w+)\s*=\s*(async\s*)?\(.*\)\s*=>/,
    /^\s*(export\s+)?(async\s+)?(\w+)\s*\(.*\)\s*{\s*$/,
    /^\s*def\s+(\w+)\s*\(/,
    /^\s*class\s+(\w+)/,
    /^\s*func\s+(\w+)/,
    /^\s*import\s+.*from/,
    /^\s*from\s+.*import/,
  ];

  for (let i = 0; i < Math.min(lines.length, 1000); i++) {
    const line = lines[i];
    if (line.length > 200) continue;
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m) {
        outline.push(`  ${i + 1}: ${line.trim().slice(0, 120)}`);
        break;
      }
    }
    if (outline.length > 50) break;
  }
  return outline.length ? `\n[Outline — top symbols]\n${outline.join('\n')}\n` : '';
}

async function readLinesRange(
  filePath: string,
  offset: number,
  limit: number
): Promise<{ lines: string[]; totalLines: number }> {
  // For large files, stream only needed lines
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let totalLines = 0;
    let currentLine = 0;
    const start = offset;
    const end = offset + limit - 1;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      currentLine++;
      totalLines = currentLine;
      if (currentLine >= start && currentLine <= end) {
        lines.push(line);
      }
    });

    rl.on('close', () => {
      // If we didn't get totalLines because we stopped early, we need to count all
      // For efficiency, if file is huge and we only read first chunk, totalLines is approximate
      // We will get accurate total via second pass if needed, but for now use currentLine
      resolve({ lines, totalLines: currentLine });
    });

    rl.on('error', reject);
    stream.on('error', reject);
  });
}

export const readFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: `Read file with token-efficient, Claude Code style. Default 100 lines. Use offset/limit for pagination. For large files, returns outline + first chunk. Supports code files, docs, PDFs. Always search before reading large files. USE FORWARD SLASHES even on Windows (e.g. C:/Users/... not C:\\Users\\...).`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to file - USE FORWARD SLASHES even on Windows',
          },
          offset: {
            type: 'number',
            description: 'Start line (1-indexed), default 1. Use for pagination.',
          },
          limit: {
            type: 'number',
            description: 'Max lines to read, default 100, max 500. Keep small for token efficiency.',
          },
          mode: {
            type: 'string',
            enum: ['content', 'outline', 'summary'],
            description: 'content=full lines, outline=symbols only, summary=first 50 lines + outline. Default content.',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args, cwd, options) {
    let filePath = typeof args.path === 'string' ? args.path : '';
    const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1;
    const limit = typeof args.limit === 'number' ? Math.min(MAX_LINE_LIMIT, Math.max(1, Math.floor(args.limit))) : DEFAULT_LINE_LIMIT;
    const mode = typeof args.mode === 'string' ? args.mode : 'content';

    if (!filePath) throw new Error('Path is required');

    // Normalize Windows backslashes to forward slashes to prevent Invalid JSON and dedup issues
    filePath = filePath.replace(/\\/g, '/');
    const resolvedPath = resolve(cwd, filePath);
    const ext = extname(resolvedPath).toLowerCase();

    if (DOC_EXTENSIONS.has(ext)) {
      return await readDocumentTool.execute({ path: filePath }, cwd, options);
    }

    const fileInfo = detectFileType(resolvedPath);
    if (fileInfo.category === 'pdf') {
      return await readDocumentTool.execute({ path: filePath }, cwd, options);
    }

    if (fileInfo.category !== 'text') {
      return `[Binary: ${fileInfo.category} (${fileInfo.mimeType}, ${fileInfo.sizeLabel})] Cannot read as text. Use appropriate tool.`;
    }

    try {
      const fileStat = await stat(resolvedPath);
      
      // Hard limit check
      if (fileStat.size > MAX_FILE_SIZE_HARD && !args.offset && mode === 'content') {
        return `[File too large: ${filePath} (${fileInfo.sizeLabel}, limit 5MB). Use mode=outline or mode=summary, or specify offset/limit to read in chunks. For code, use search_files to find relevant sections first.]`;
      }

      // Check cache
      const cached = getCached(resolvedPath, fileStat.mtimeMs);
      let lines: string[];
      let totalLines: number;

      if (cached && offset === 1 && limit >= cached.lines.length && fileStat.size < LARGE_FILE_THRESHOLD) {
        lines = cached.lines;
        totalLines = lines.length;
      } else if (fileStat.size > LARGE_FILE_THRESHOLD) {
        // Stream for large files - token efficient
        const result = await readLinesRange(resolvedPath, offset, limit);
        lines = result.lines;
        totalLines = result.totalLines;
      } else {
        const content = await readFile(resolvedPath, 'utf-8');
        const allLines = content.split('\n');
        totalLines = allLines.length;
        
        // Cache small files
        if (fileStat.size < LARGE_FILE_THRESHOLD) {
          setCached(resolvedPath, {
            content,
            lines: allLines,
            mtime: fileStat.mtimeMs,
            size: fileStat.size,
          });
        }

        const startIndex = offset - 1;
        const endIndex = Math.min(totalLines, startIndex + limit);
        lines = allLines.slice(startIndex, endIndex);
      }

      if (mode === 'outline') {
        // For outline, we need full file or at least first 1000 lines
        let outlineLines = lines;
        if (fileStat.size < LARGE_FILE_THRESHOLD && cached) {
          outlineLines = cached.lines;
        } else if (offset === 1 && lines.length < 1000) {
          // Already have enough for outline from current read, but try to get more
          const content = await readFile(resolvedPath, 'utf-8');
          outlineLines = content.split('\n');
        }
        const outline = extractOutline(outlineLines, filePath);
        return `[File: ${filePath} | ${fileInfo.sizeLabel} | ${totalLines} lines | OUTLINE mode]\n${outline || '(no symbols detected)'}\n[Use offset/limit with mode=content to read specific sections]`;
      }

      if (mode === 'summary') {
        const summaryLines = lines.slice(0, 50);
        const outline = extractOutline(lines, filePath);
        const header = `[File: ${filePath} | ${fileInfo.sizeLabel} | ${totalLines} lines | SUMMARY mode — first 50 lines + outline]\n`;
        return header + formatLineNumbered(summaryLines, offset) + outline + `\n[Use offset=${offset + 50} limit=${limit} for more, or mode=outline for symbols]`;
      }

      const startIndex = offset;
      const endIndex = offset + lines.length - 1;
      const hasMore = endIndex < totalLines;
      const isPartial = offset > 1 || hasMore;
      
      let header = '';
      if (fileStat.size > LARGE_FILE_THRESHOLD || isPartial) {
        header = `[${filePath} | ${fileInfo.sizeLabel} | Lines ${startIndex}-${endIndex}/${totalLines}${hasMore ? ` | Next: offset=${endIndex + 1}` : ''}]\n`;
      } else {
        header = `[${filePath} | ${totalLines} lines]\n`;
      }

      // Token-efficient: no extra padding, compact line numbers
      const result = header + formatLineNumbered(lines, offset);
      
      // For very large results, truncate further
      if (result.length > 15000) {
        return result.slice(0, 12000) + `\n... [${result.length - 12000} chars truncated] ...\n` + result.slice(-2000);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Read failed: ${message}`);
    }
  },
};
