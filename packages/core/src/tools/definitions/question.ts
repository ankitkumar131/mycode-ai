import type { ToolModule, AskUserQuestion } from '../types.js';

/**
 * question — let the agent ask instead of guess.
 *
 * The most expensive failure mode in an agent is a confident edit to the wrong
 * file. When the request is genuinely ambiguous ("update the button"), asking is
 * cheaper than any amount of retrying — and it is the one action the model
 * cannot take on its own.
 *
 * Previously this tool existed but was never registered, so it could never be
 * called.
 */
export const questionTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'question',
      description:
        'Ask the user a question when you are genuinely blocked on a decision only they can make ' +
        '(which of several candidates to modify, which behaviour is intended, which environment to target). ' +
        'Prefer asking over guessing when the cost of guessing wrong is a wrong edit. ' +
        'Do not use this for information you could find by reading the code.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'One or more questions to ask. Keep this to what genuinely blocks you.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question to ask' },
                header: { type: 'string', description: 'Short label used as the answer key' },
                options: {
                  type: 'array',
                  description: 'Suggested answers the user can pick from',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['label'],
                  },
                },
                multiple: { type: 'boolean', description: 'Allow selecting more than one option' },
              },
              required: ['question'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  execute: (async (
    args: Record<string, unknown>,
    _cwd: string,
    options?: { askUser?: (questions: AskUserQuestion[]) => Promise<Record<string, string>> },
  ) => {
    const raw = Array.isArray(args.questions) ? args.questions : [];
    const questions: AskUserQuestion[] = raw
      .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === 'object')
      .map((q) => ({
        question: String(q.question ?? '').trim(),
        header: typeof q.header === 'string' ? q.header : undefined,
        options: Array.isArray(q.options)
          ? (q.options as Array<Record<string, unknown>>).map((o) => ({
              label: String(o.label ?? ''),
              description: typeof o.description === 'string' ? o.description : undefined,
            }))
          : undefined,
        multiple: q.multiple === true,
      }))
      .filter((q) => q.question.length > 0);

    if (!questions.length) return 'Error: question requires at least one question with text.';

    if (!options?.askUser) {
      return (
        'Error: this session cannot prompt the user. Proceed with your best judgement, ' +
        'state the assumption you made explicitly, and continue.'
      );
    }

    try {
      const answers = await options.askUser(questions);
      const rendered = questions
        .map((q) => {
          const key = q.header ?? q.question;
          const answer = answers[key] ?? answers[q.question] ?? '(no answer)';
          return `Q: ${q.question}\nA: ${answer}`;
        })
        .join('\n\n');
      return rendered;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: failed to collect an answer (${msg}). Proceed with your best judgement and state the assumption.`;
    }
  }) as unknown as ToolModule['execute'],
};
