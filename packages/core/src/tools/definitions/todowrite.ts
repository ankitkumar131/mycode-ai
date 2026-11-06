import type { ToolModule } from '../types.js';
import { todoStore, normalizeTodos, type Todo } from '../todo-store.js';

/**
 * todo_write — the agent's plan, made visible.
 *
 * Two changes from the previous implementation, both load-bearing:
 *
 *   1. State lives in the per-session `todoStore`, not a module-global
 *      variable. Concurrent sessions no longer overwrite each other's plans,
 *      and the UI can subscribe to changes.
 *
 *   2. The schema is `{ content, status, priority }` with a four-state status,
 *      which is what agentic models are trained to emit. A `done` boolean can
 *      only say "finished / not finished"; it cannot express "working on this
 *      now", which is exactly the information the user needs to see.
 *
 * `text`/`done` are still accepted so existing sessions and prompts keep working.
 */
export const todoWriteTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'todo_write',
      description:
        'Create and maintain a structured task list for the current session. Use it to track progress ' +
        'during multi-step work and keep statuses current. Exactly one task should be in_progress at a time.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The updated todo list. This replaces the previous list.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Brief description of the task' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                  description: 'Current status of the task',
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Priority level of the task',
                },
              },
              required: ['content', 'status'],
            },
          },
          merge: {
            type: 'boolean',
            description:
              'When true, update matching items and append new ones instead of replacing the whole list.',
          },
        },
        required: ['todos'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, _cwd: string, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId ?? 'default';
    const raw = args.todos ?? args.items;
    const merge = args.merge === true;

    let todos: Todo[];
    if (merge) {
      todos = [...todoStore.merge(sessionId, (Array.isArray(raw) ? raw : []) as readonly Todo[])];
    } else {
      todos = normalizeTodos(raw);
      todoStore.set(sessionId, todos);
    }

    if (todos.length === 0) return 'Todo list cleared.';

    // Return a rendered checklist rather than JSON: the model re-reads its own
    // plan every turn, and a rendered list costs fewer tokens than the object
    // while being easier to follow.
    const glyph = { completed: '[x]', in_progress: '[>]', cancelled: '[-]', pending: '[ ]' } as const;
    const counts = { completed: 0, in_progress: 0, pending: 0, cancelled: 0 };
    for (const t of todos) counts[t.status]++;

    const lines = todos.map((t) => {
      const pr = t.priority === 'high' ? '!' : t.priority === 'low' ? '.' : ' ';
      return `${glyph[t.status] ?? '[ ]'}${pr} ${t.content}`;
    });

    return (
      `Todo list updated — ${counts.completed} done, ${counts.in_progress} in progress, ` +
      `${counts.pending} pending${counts.cancelled ? `, ${counts.cancelled} cancelled` : ''}.\n\n` +
      lines.join('\n') +
      (counts.in_progress === 0 && counts.pending > 0
        ? '\n\nNo task is marked in_progress — set one before continuing.'
        : '')
    );
  }) as unknown as ToolModule['execute'],
};
