import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { ToolModule } from '../types.js';

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export const editFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'edit-file',
      description: 'Apply a search-and-replace edit to a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          oldString: {
            type: 'string',
            description: 'Exact text to search for (must match existing content exactly)',
          },
          newString: {
            type: 'string',
            description: 'Replacement text',
          },
          createIfMissing: {
            type: 'boolean',
            description: 'Create the file if it does not exist (default: false)',
          },
          replaceAll: {
            type: 'boolean',
            description: 'Replace all occurrences of oldString (default: false)',
          },
          dryRun: {
            type: 'boolean',
            description: 'Show diff without applying changes (default: false)',
          },
        },
        required: ['path', 'oldString', 'newString'],
      },
    },
  },

  async execute(args, cwd) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const oldString = typeof args.oldString === 'string' ? args.oldString : '';
    const newString = typeof args.newString === 'string' ? args.newString : '';
    const createIfMissing = args.createIfMissing === true;
    const replaceAll = args.replaceAll === true;
    const dryRun = args.dryRun === true;

    if (!filePath) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(cwd, filePath);

    let content: string;
    try {
      content = normalizeLineEndings(await readFile(resolvedPath, 'utf-8'));
    } catch {
      if (createIfMissing) {
        content = '';
      } else {
        throw new Error(`File not found: ${filePath}`);
      }
    }

    const normalizedOld = normalizeLineEndings(oldString);
    const normalizedNew = normalizeLineEndings(newString);

    let newContent: string;
    if (replaceAll) {
      const occurrences = content.split(normalizedOld).length - 1;
      if (occurrences === 0) {
        throw new Error(`Could not find "${oldString.slice(0, 50)}" in the file`);
      }
      newContent = content.split(normalizedOld).join(normalizedNew);
    } else {
      if (!content.includes(normalizedOld)) {
        throw new Error(`Could not find "${oldString.slice(0, 50)}" in the file`);
      }
      newContent = content.replace(normalizedOld, normalizedNew);
    }

    if (dryRun) {
      const patch = createTwoFilesPatch(filePath, filePath, content, newContent);
      const summary: string[] = [];
      const added = (patch.match(/^\+/gm) || []).length;
      const removed = (patch.match(/^-/gm) || []).length;
      summary.push(`Dry run for ${filePath}:`);
      summary.push(`  ${added} additions, ${removed} removals`);
      summary.push('');
      summary.push(patch);
      return summary.join('\n');
    }

    const dir = dirname(resolvedPath);
    await mkdir(dir, { recursive: true });
    await writeFile(resolvedPath, newContent, 'utf-8');

    const patch = createTwoFilesPatch(filePath, filePath, content, newContent);
    const added = (patch.match(/^\+/gm) || []).length;
    const removed = (patch.match(/^-/gm) || []).length;

    const summary: string[] = [];
    summary.push(`Applied edit to ${filePath}:`);
    summary.push(`  ${added} additions, ${removed} removals`);
    return summary.join('\n');
  },
};
