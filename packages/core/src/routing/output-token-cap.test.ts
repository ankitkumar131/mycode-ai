import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_COOLDOWN_MS } from './base-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

/**
 * A task that needed a long tool call must not end silently.
 *
 * Regression: `max_tokens` was hard-coded to 4096 and nothing read
 * `finish_reason`. Asking for a React app made the model emit a `write_file`
 * call whose JSON arguments exceeded 4096 tokens, so the response was truncated
 * mid-string, `JSON.parse` threw, the tool was skipped, and the turn returned to
 * the prompt having produced 4.2k output tokens and zero visible output. The
 * user saw mycode accept the task and then do nothing.
 */
describe('output token cap', () => {
  it('defaults well above the old 4096 so a component-sized tool call fits', () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThan(4096);
  });

  it('lets a provider override the cap', () => {
    const p = new OpenAICompatibleProvider({
      name: 'p',
      model: 'm',
      apiKey: 'k',
      maxOutputTokens: 32768,
    });
    // The cap is private; assert via the params the provider builds.
    const params = (p as any).buildParams([], []);
    expect(params.max_tokens).toBe(32768);
  });

  it('falls back to the shared default when unset', () => {
    const p = new OpenAICompatibleProvider({ name: 'p', model: 'm', apiKey: 'k' });
    const params = (p as any).buildParams([], []);
    expect(params.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it('still honours an explicit per-call override', () => {
    const p = new OpenAICompatibleProvider({
      name: 'p',
      model: 'm',
      apiKey: 'k',
      maxOutputTokens: 32768,
    });
    const params = (p as any).buildParams([], [], { max_tokens: 512 });
    expect(params.max_tokens).toBe(512);
  });

  it('leaves the cooldown default untouched', () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(30_000);
  });
});
