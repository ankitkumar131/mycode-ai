/**
 * Tool: List Directory
 * Lists files and subdirectories with a tree-like structure.
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, relative, join } from 'path';

export const listDirTool = {
  definition: {
    type: 'function',
    function: {
      name: 'listDirectory',
      description:
        'List the contents of a directory. Shows files and subdirectories with their sizes. ' +
        'Use this to understand the project structure before making changes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute path to the directory to list. Use "." for current directory.',
          },
          depth: {
            type: 'integer',
            description: 'Maximum depth to recurse into subdirectories. Default is 2.',
          },
        },
        required: ['path'],
      },
    },
  },

  /**
   * Execute the listDirectory tool.
   */
  execute(args, cwd) {
    const dirPath = resolve(cwd, args.path || '.');
    const maxDepth = args.depth ?? 2;

    if (!existsSync(dirPath)) {
      return `Error: Directory not found: ${args.path}`;
    }

    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return `Error: "${args.path}" is a file, not a directory. Use readFile instead.`;
    }

    try {
      const tree = buildTree(dirPath, cwd, 0, maxDepth);
      const relPath = relative(cwd, dirPath) || '.';
      return `Directory: ${relPath}/\n${'─'.repeat(50)}\n${tree}`;
    } catch (err) {
      return `Error listing directory: ${err.message}`;
    }
  },
};

/**
 * Recursively build a tree representation.
 */
function buildTree(dirPath, cwd, depth, maxDepth) {
  if (depth > maxDepth) return '';

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const lines = [];

  // Skip common uninteresting directories
  const skipDirs = ['node_modules', '.git', '.next', 'dist', '__pycache__', '.mycode'];

  // Sort: directories first, then files, both alphabetical
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (entry.name.startsWith('.') && depth === 0 && entry.name !== '.env.example') {
      continue; // Skip hidden files at root level (except useful ones)
    }

    const indent = '  '.repeat(depth);
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) {
        lines.push(`${indent}📁 ${entry.name}/ (skipped)`);
        continue;
      }
      lines.push(`${indent}📁 ${entry.name}/`);
      const subtree = buildTree(fullPath, cwd, depth + 1, maxDepth);
      if (subtree) lines.push(subtree);
    } else {
      const stat = statSync(fullPath);
      const size = formatSize(stat.size);
      lines.push(`${indent}📄 ${entry.name} (${size})`);
    }
  }

  return lines.join('\n');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
