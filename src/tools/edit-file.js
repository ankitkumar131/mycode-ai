/**
 * Tool: Edit File
 * Applies targeted search-and-replace edits to an existing file.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { createPatch } from 'diff';

export const editFileTool = {
  definition: {
    type: 'function',
    function: {
      name: 'editFile',
      description:
        'Apply targeted edits to an existing file using search and replace. ' +
        'Provide the exact text to find and the replacement text. ' +
        'This is preferred over writeFile for making small, specific changes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute path to the file to edit.',
          },
          edits: {
            type: 'array',
            description: 'Array of search-and-replace operations to apply.',
            items: {
              type: 'object',
              properties: {
                search: {
                  type: 'string',
                  description: 'The exact text to find in the file.',
                },
                replace: {
                  type: 'string',
                  description: 'The text to replace it with.',
                },
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
  },

  /**
   * Execute the editFile tool.
   * @param {object} args - { path, edits: [{search, replace}] }
   * @param {string} cwd - Current working directory
   * @param {object} options - { confirmFn }
   * @returns {Promise<string>}
   */
  async execute(args, cwd, options = {}) {
    const filePath = resolve(cwd, args.path);
    const relPath = relative(cwd, filePath);

    if (!existsSync(filePath)) {
      return `Error: File not found: ${relPath}`;
    }

    let content = readFileSync(filePath, 'utf-8');
    const original = content;
    let appliedCount = 0;

    for (const edit of args.edits) {
      if (content.includes(edit.search)) {
        content = content.replace(edit.search, edit.replace);
        appliedCount++;
      } else {
        return `Error: Could not find the search text in ${relPath}:\n"${edit.search.slice(0, 100)}..."`;
      }
    }

    if (appliedCount === 0) {
      return `No edits were applied — search text not found in ${relPath}.`;
    }

    // Generate diff
    const diffText = createPatch(relPath, original, content, 'before', 'after');

    // Ask for confirmation
    if (options.confirmFn) {
      const confirmed = await options.confirmFn(relPath, diffText);
      if (!confirmed) {
        return `Edit to "${relPath}" was cancelled by user.`;
      }
    }

    try {
      writeFileSync(filePath, content, 'utf-8');
      return `✔ Applied ${appliedCount} edit(s) to ${relPath}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  },
};
