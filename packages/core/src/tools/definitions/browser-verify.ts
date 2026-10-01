import type { ToolModule, ToolExecuteOptions, SafetyResult } from '../types.js';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const elevatedBrowserAction: SafetyResult = {
  level: 'elevated',
  reason: 'Browser verification with mutations can submit forms or change remote state.',
  warnings: ['Use read-only verification unless the user explicitly approved browser mutations.'],
};

export const browserVerifyTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'browser_verify',
      description: 'Use the configured Jev-compatible browser worker to verify a browser-visible goal. Default mode is read-only; it returns structured evidence and never counts an unconfigured verifier as a pass.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Application URL to open, including http:// or https://' },
          goal: { type: 'string', description: 'Browser-visible behavior to verify. State the expected outcome precisely.' },
          expected: { type: 'array', items: { type: 'string' }, description: 'Optional visible-text fragments that must be present for a pass.' },
          timeout: { type: 'number', description: 'Verification timeout in milliseconds.' },
          record_dir: { type: 'string', description: 'Optional trace/screenshot directory inside the workspace.' },
          allow_mutations: { type: 'boolean', description: 'Allow clicks that may submit or change remote state. Defaults to false.' },
        },
        required: ['url', 'goal'],
      },
    },
  },

  async execute(args, cwd, options?: ToolExecuteOptions) {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    if (!/^https?:\/\//i.test(url)) throw new Error('browser_verify requires an http:// or https:// URL.');
    if (!goal) throw new Error('browser_verify requires a goal.');

    const allowMutations = args.allow_mutations === true;
    if (allowMutations && options?.confirmFn) {
      const allowed = await options.confirmFn(`browser mutations at ${url}`, goal, elevatedBrowserAction);
      if (!allowed) return json({ success: false, status: 'blocked', summary: 'Browser mutations were not approved.' });
    }

    if (!options?.browserVerifier) {
      return json({
        success: false,
        status: 'unavailable',
        summary: 'No Jev-compatible browser verifier is configured.',
        error: 'Configure integrations.browser.command and its bridge before requesting browser verification.',
      });
    }

    const expected = Array.isArray(args.expected)
      ? args.expected.filter((item): item is string => typeof item === 'string')
      : undefined;
    const result = await options.browserVerifier.verify({
      url,
      goal,
      expected,
      cwd,
      recordDir: typeof args.record_dir === 'string' ? args.record_dir : undefined,
      allowMutations,
    }, { cwd, signal: options.abortSignal });
    return json(result);
  },
};
