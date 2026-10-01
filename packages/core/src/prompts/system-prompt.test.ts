import { SystemPromptBuilder } from './system-prompt.js';
import { PONYTAIL_MOTTO } from '../policy/ponytail.js';

describe('SystemPromptBuilder Ponytail integration', () => {
  it('injects Ponytail before the first request by default', async () => {
    const prompt = await SystemPromptBuilder.buildSystemPrompt(process.cwd(), {
      includeSkills: false,
      tools: [],
    });
    expect(prompt).toContain(PONYTAIL_MOTTO);
    expect(prompt).toContain('every user request');
  });

  it('can rebuild without Ponytail when explicitly turned off', async () => {
    const prompt = await SystemPromptBuilder.buildSystemPrompt(process.cwd(), {
      includeSkills: false,
      tools: [],
      ponytailMode: 'off',
    });
    expect(prompt).not.toContain(PONYTAIL_MOTTO);
  });
});
