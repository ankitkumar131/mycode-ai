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
  execute: async (args: { text: string; options?: string[] }) => {
    return {
      success: true,
      question: args.text,
      options: args.options || [],
      message: 'Question presented to user.',
    };
  },
};
