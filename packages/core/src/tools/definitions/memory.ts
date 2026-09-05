/**
 * memory — Persistent, agent-curated notes in ~/.mycode/MEMORY.md.
 * Injected into the system prompt on every session start.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolModule } from '../types.js';

export function memoryPath(): string {
  return join(homedir(), '.mycode', 'MEMORY.md');
}

export function readMemoryFile(): string {
  const p = memoryPath();
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

export function writeMemoryFile(content: string): void {
  const p = memoryPath();
  mkdirSync(join(homedir(), '.mycode'), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

const MAX_MEMORY_CHARS = 8000;

export const memoryTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'memory',
      description:
        'Persist durable facts about the user or their environment across sessions (preferences, project conventions, machine quirks). Keep entries short and factual. Actions: add, replace, remove, list.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'replace', 'remove', 'list'] },
          content: { type: 'string', description: 'Memory line to add (add), or new text (replace)' },
          target: { type: 'string', description: 'Existing text to replace/remove (substring match)' },
        },
        required: ['action'],
      },
    },
  },
  async execute(args) {
    const action = String(args.action ?? 'list');
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    const target = typeof args.target === 'string' ? args.target : '';
    let mem = readMemoryFile();

    switch (action) {
      case 'list':
        return mem.trim() || '(memory is empty)';
      case 'add': {
        if (!content) throw new Error('content is required');
        if (mem.includes(content)) return 'Already in memory.';
        const line = content.startsWith('-') ? content : `- ${content}`;
        mem = (mem.trim() ? mem.trimEnd() + '\n' : '# Memory\n') + line + '\n';
        if (mem.length > MAX_MEMORY_CHARS) throw new Error(`Memory would exceed ${MAX_MEMORY_CHARS} characters — remove or consolidate entries first.`);
        writeMemoryFile(mem);
        return `Remembered: ${content}`;
      }
      case 'replace': {
        if (!target || !content) throw new Error('target and content are required');
        if (!mem.includes(target)) throw new Error('target not found in memory');
        writeMemoryFile(mem.replace(target, content));
        return 'Memory updated.';
      }
      case 'remove': {
        if (!target) throw new Error('target is required');
        const lines = mem.split('\n');
        const kept = lines.filter(l => !l.includes(target));
        if (kept.length === lines.length) throw new Error('target not found in memory');
        writeMemoryFile(kept.join('\n'));
        return `Removed ${lines.length - kept.length} line(s).`;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};
