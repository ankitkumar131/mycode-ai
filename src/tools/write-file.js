/**
 * Tool: Write File
 * Creates or overwrites a file with the given content.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { createPatch } from 'diff';

export const writeFileTool = {
  definition: {
    type: 'function',
    function: {
      name: 'writeFile',
      description:
        'Create a new file or overwrite an existing file with the given content. ' +
        'Parent directories will be created automatically if they don\'t exist. ' +
        'Always prefer editFile for making targeted changes to existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute path to the file to write.',
          },
          content: {
            type: 'string',
            description: 'The complete content to write to the file.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },

  /**
   * Execute the writeFile tool.
   * @param {object} args - { path, content }
   * @param {string} cwd - Current working directory
   * @param {object} options - { confirmFn } — function to confirm writes
   * @returns {Promise<string>} Result message
   */
  async execute(args, cwd, options = {}) {
    const filePath = resolve(cwd, args.path);
    const relPath = relative(cwd, filePath);
    const isNew = !existsSync(filePath);

    // Generate diff for existing files
    let diffText = null;
    if (!isNew) {
      const existing = readFileSync(filePath, 'utf-8');
      diffText = createPatch(relPath, existing, args.content, 'before', 'after');
    }

    // Ask for confirmation if a confirm function is provided
    if (options.confirmFn) {
      const confirmed = await options.confirmFn(relPath, diffText);
      if (!confirmed) {
        return `Write to "${relPath}" was cancelled by user.`;
      }
    }

    try {
      // Create parent directories if needed
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(filePath, args.content, 'utf-8');

      if (isNew) {
        return `✔ Created new file: ${relPath} (${args.content.length} bytes)`;
      } else {
        return `✔ Updated file: ${relPath} (${args.content.length} bytes)`;
      }
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  },
};
