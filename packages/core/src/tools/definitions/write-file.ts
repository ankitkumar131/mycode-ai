import { writeFile, mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { ToolModule } from '../types.js';

export const writeFileTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create a new file or completely overwrite an existing one. Parent directories are created automatically. For small changes to existing files prefer the patch tool. Supports mode="append".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file' },
          content: { type: 'string', description: 'Full content to write' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: 'overwrite (default) or append' },
        },
        required: ['path', 'content'],
      },
    },
  },

  async execute(args, cwd, options) {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const mode = args.mode === 'append' ? 'append' : 'overwrite';

    if (!filePath) throw new Error('Path is required');

    const resolvedPath = resolve(cwd, filePath);
    const exists = existsSync(resolvedPath);
    let previous = '';
    if (exists && mode === 'overwrite') {
      try {
        previous = await readFile(resolvedPath, 'utf-8');
      } catch {
        previous = '';
      }
    }

    let diffPreview = '';
    let added = content.split('\n').length;
    let removed = 0;
    if (exists && mode === 'overwrite') {
      const patch = createTwoFilesPatch(filePath, filePath, previous, content, '', '', { context: 2 });
      added = (patch.match(/^\+(?!\+\+)/gm) || []).length;
      removed = (patch.match(/^-(?!--)/gm) || []).length;
      diffPreview = patch.split('\n').slice(4).join('\n').trim();
    }

    if (options?.confirmFn) {
      const summary = exists
        ? mode === 'append'
          ? `append ${content.length} chars to existing file`
          : `overwrite existing file (+${added} −${removed})\n${diffPreview.slice(0, 1500)}`
        : `create new file (${content.split('\n').length} lines, ${content.length} bytes)`;
      const allowed = await options.confirmFn(filePath, summary);
      if (!allowed) return `Write to ${filePath} was cancelled by user.`;
    }

    try {
      await mkdir(dirname(resolvedPath), { recursive: true });
      if (mode === 'append') {
        await appendFile(resolvedPath, content, 'utf-8');
        return `Appended ${content.length} bytes to ${filePath}`;
      }
      await writeFile(resolvedPath, content, 'utf-8');
      const lines = content.split('\n').length;
      if (exists) {
        return `Overwrote ${filePath} (${lines} lines, +${added} −${removed})${diffPreview ? `\n\n${diffPreview.slice(0, 3000)}` : ''}`;
      }
      return `Created ${filePath} (${lines} lines, ${content.length} bytes)`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write file: ${message}`);
    }
  },
};
