import type { ToolModule, ToolExecuteOptions } from '../types.js';
import type { DecisionQuestion } from '../../integrations/decision-gate.js';

export const decisionGateTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'decision_gate',
      description: 'Use the configured Laya-compatible decision engine for typed classification, scoring, yes/no, routing, or confidence decisions. It does not generate code or execute commands.',
      parameters: {
        type: 'object',
        properties: {
          state: { description: 'Text or JSON state to evaluate.' },
          questions: { type: 'object', description: 'Named typed questions with type choice, score, or noul and their criteria.' },
          model: { type: 'string', description: 'Optional Laya checkpoint name.' },
          max_len: { type: 'number', description: 'Optional maximum input length.' },
          min_confidence: { type: 'number', description: 'Optional abstention threshold.' },
        },
        required: ['state', 'questions'],
      },
    },
  },

  async execute(args, cwd, options?: ToolExecuteOptions) {
    if (!options?.decisionGate) {
      return JSON.stringify({
        success: false,
        status: 'unavailable',
        summary: 'No Laya-compatible decision gate is configured.',
        error: 'Configure integrations.decision.command and its bridge before requesting typed decisions.',
      }, null, 2);
    }

    const questions = args.questions;
    if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
      throw new Error('decision_gate requires a questions object.');
    }
    const state = args.state;
    if (state === undefined || state === null) throw new Error('decision_gate requires state.');

    const result = await options.decisionGate.decide({
      state,
      questions: questions as Record<string, DecisionQuestion>,
      model: typeof args.model === 'string' ? args.model : undefined,
      maxLen: typeof args.max_len === 'number' ? args.max_len : undefined,
      minConfidence: typeof args.min_confidence === 'number' ? args.min_confidence : undefined,
    }, { cwd, signal: options.abortSignal });
    return JSON.stringify(result, null, 2);
  },
};
