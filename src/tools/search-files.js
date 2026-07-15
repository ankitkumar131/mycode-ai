/**
 * Tool: Search Files
 * Searches for text patterns across files in the project.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, relative, join, extname } from 'path';

export const searchFilesTool = {
  definition: {
    type: 'function',
    function: {
      name: 'searchFiles',
      description:
        'Search for a text pattern across files in the project. ' +
        'Returns matching lines with file paths and line numbers. ' +
        'Similar to grep/ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regex pattern to search for.',
          },
          path: {
            type: 'string',
            description: 'Directory or file to search in. Defaults to current directory.',
          },
          filePattern: {
            type: 'string',
            description: 'Glob pattern to filter files. E.g., "*.js", "*.py". Defaults to all text files.',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive. Default is false.',
          },
        },
        required: ['pattern'],
      },
    },
  },

  /**
   * Execute the searchFiles tool.
   */
  execute(args, cwd) {
    const searchPath = resolve(cwd, args.path || '.');
    const caseSensitive = args.caseSensitive ?? false;
    const maxResults = 50;

    if (!existsSync(searchPath)) {
      return `Error: Path not found: ${args.path || '.'}`;
    }

    try {
      let regex;
      try {
        regex = new RegExp(args.pattern, caseSensitive ? 'g' : 'gi');
      } catch {
        // If not a valid regex, escape it and search as literal
        const escaped = args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }

      const results = [];
      const files = collectFiles(searchPath, args.filePattern);

      for (const file of files) {
        if (results.length >= maxResults) break;

        try {
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (regex.test(lines[i])) {
              results.push({
                file: relative(cwd, file),
                line: i + 1,
                content: lines[i].trim().slice(0, 200),
              });
            }
            regex.lastIndex = 0; // Reset regex state
          }
        } catch {
          // Skip binary or unreadable files
        }
      }

      if (results.length === 0) {
        return `No matches found for "${args.pattern}"`;
      }

      const output = results
        .map((r) => `${r.file}:${r.line} │ ${r.content}`)
        .join('\n');

      return `Found ${results.length} match(es)${results.length >= maxResults ? ' (capped at 50)' : ''}:\n${'─'.repeat(60)}\n${output}`;
    } catch (err) {
      return `Error searching: ${err.message}`;
    }
  },
};

/**
 * Collect all searchable text files in a directory.
 */
function collectFiles(dirPath, filePattern, collected = []) {
  const stat = statSync(dirPath);

  if (!stat.isDirectory()) {
    if (isTextFile(dirPath, filePattern)) {
      collected.push(dirPath);
    }
    return collected;
  }

  const skipDirs = ['node_modules', '.git', '.next', 'dist', '__pycache__', '.mycode', 'coverage'];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          collectFiles(fullPath, filePattern, collected);
        }
      } else if (isTextFile(fullPath, filePattern)) {
        collected.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return collected;
}

/**
 * Check if a file is a searchable text file.
 */
function isTextFile(filePath, filePattern) {
  const ext = extname(filePath).toLowerCase();
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib'];

  if (binaryExts.includes(ext)) return false;

  if (filePattern) {
    // Simple glob matching: *.js, *.py, etc.
    const pattern = filePattern.replace('*', '');
    if (!filePath.endsWith(pattern)) return false;
  }

  // Check file size — skip very large files
  try {
    const stat = statSync(filePath);
    if (stat.size > 500_000) return false;
  } catch {
    return false;
  }

  return true;
}
