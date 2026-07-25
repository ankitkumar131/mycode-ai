import type { ToolModule } from '../types.js';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

let activeTodos: TodoItem[] = [];

export const todoWriteTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Update or manage the current todo task list for tracking multi-step work.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                done: { type: 'boolean' },
              },
              required: ['id', 'text', 'done'],
            },
            description: 'Updated list of todo task items.',
          },
        },
        required: ['items'],
      },
    },
  },
  execute: async (args: { items: TodoItem[] }) => {
    activeTodos = args.items;
    return {
      success: true,
      todos: activeTodos,
    };
  },
};
