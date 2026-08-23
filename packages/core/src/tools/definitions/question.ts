import type { ToolModule } from '../types.js';

export const questionTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'question',
      description: 'Ask the user a clarifying question or request input.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The question text to present to the user.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of choice options.',
          },
        },
        required: ['text'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, _cwd: string) => {
    return {
      success: true,
      question: typeof args.text === 'string' ? args.text : '',
      options: Array.isArray(args.options) ? (args.options as string[]) : [],
      message: 'Question presented to user.',
    };
  }) as unknown as ToolModule['execute'],
};
