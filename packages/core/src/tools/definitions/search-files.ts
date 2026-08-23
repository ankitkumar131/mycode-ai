import { readdir } from 'node:fs/promises';
import { statSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import type { ToolModule } from '../types.js';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg',
  '.o', '.a', '.lib', '.obj',
  '.pyc', '.pyo',
  '.DS_Store',
  '.gitkeep',
]);

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_RESULTS = 50;

export const searchFilesTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'search-files',
      description: 'Search for files matching a pattern or containing specific content',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g. "*.ts", "src/**/*.ts")',
          },
          content: {
            type: 'string',
            description: 'Text content to search for in files',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (default: cwd)',
          },
          include: {
            type: 'string',
            description: 'File extension filter (e.g. ".ts")',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results (default: 50)',
          },
        },
        anyOf: [
          { required: ['pattern'] },
          { required: ['content'] },
        ],
      },
    },
  },

  async execute(args, cwd) {
    const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;
    const content = typeof args.content === 'string' ? args.content : undefined;
    const searchPath = typeof args.path === 'string' ? resolve(cwd, args.path) : cwd;
    const include = typeof args.include === 'string' ? args.include : undefined;
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : MAX_RESULTS;
    const results: string[] = [];

    function shouldInclude(filePath: string): boolean {
      const ext = extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) return false;
      if (include && !filePath.endsWith(include)) return false;
      return true;
    }

    async function searchFile(filePath: string): Promise<void> {
      try {
        const stats = statSync(filePath);
        if (stats.size > MAX_FILE_SIZE) return;
        if (!stats.isFile()) return;

        const content_data = readFileSync(filePath, 'utf-8');
        const lines = content_data.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(content!.toLowerCase())) {
            const relativePath = filePath.startsWith(searchPath)
              ? filePath.slice(searchPath.length + 1).replace(/\\/g, '/')
              : filePath;
            results.push(`${relativePath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (results.length >= maxResults) return;
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    function matchGlob(name: string, glob: string): boolean {
      if (glob === '*') return true;
      if (glob.startsWith('*.')) {
        return name.endsWith(glob.slice(1));
      }
      if (glob.endsWith('/**')) {
        return true; // match all children
      }
      return name.includes(glob.replace(/\*/g, ''));
    }

    async function walk(dir: string): Promise<void> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }

      for (const name of names) {
        if (name.startsWith('.') && name !== '.') continue;
        if (name === 'node_modules' || name === '.git') continue;

        const fullPath = resolve(dir, name);
        let isDir = false;
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }

        if (results.length >= maxResults) return;

        if (content) {
          // Content search mode
          if (!isDir && shouldInclude(fullPath)) {
            await searchFile(fullPath);
          }
          if (isDir) {
            await walk(fullPath);
          }
        } else if (pattern) {
          // Pattern search mode
          if (matchGlob(name, pattern) && shouldInclude(fullPath)) {
            const relativePath = fullPath.startsWith(searchPath)
              ? fullPath.slice(searchPath.length + 1).replace(/\\/g, '/')
              : fullPath;
            results.push(`${relativePath}${isDir ? '/' : ''}`);
            if (results.length >= maxResults) return;
          }
          if (isDir) {
            await walk(fullPath);
          }
        }
      }
    }

    const startTime = Date.now();
    await walk(searchPath);
    const elapsed = Date.now() - startTime;

    if (results.length === 0) {
      return 'No matching files found.';
    }

    const output = results.slice(0, maxResults).join('\n');
    const summary = `\n\nFound ${results.length} result(s) in ${(elapsed / 1000).toFixed(1)}s`;
    return output + summary;
  },
};
