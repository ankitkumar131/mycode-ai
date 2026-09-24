import { describe, it, expect } from 'vitest';
import { SystemPromptBuilder } from './system-prompt.js';

/**
 * The prompt must tell the model to build large files incrementally.
 *
 * Regression: with no size guidance, the model tried to emit a whole React app
 * as a single `write_file` call. That exceeds the per-response output token cap,
 * the JSON arguments are truncated mid-string, the tool call is dropped, and the
 * turn ends having done nothing. Raising the cap only moves the ceiling — the
 * fix is to stop the model attempting it in the first place.
 */
describe('system prompt incremental-write guidance', () => {
  it('exposes the builder so guidance can be asserted', () => {
    const b = new SystemPromptBuilder();
    b.addSection('x');
    expect(b.build()).toBe('x');
  });

  it('the working rules mention building big files incrementally', async () => {
    // The rules live inside buildSystemPrompt; assert the source carries them so
    // a future edit cannot quietly drop the guidance.
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('./system-prompt.ts', import.meta.url), 'utf-8');
    expect(src).toContain('Build big files incrementally');
    expect(src).toContain('Skeleton with write_file');
  });

  it('the write_file tool guidance warns about the token cap', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('./system-prompt.ts', import.meta.url), 'utf-8');
    expect(src).toContain('NEVER emit a large file in one call');
    expect(src).toContain('truncated mid-JSON');
  });

  it('the working rules stay uniquely numbered', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('./system-prompt.ts', import.meta.url), 'utf-8');
    const start = src.indexOf('Working rules:');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 3000);
    const numbers = [...block.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    // Must start at 1 and increase by exactly 1 with no duplicates.
    expect(numbers.length).toBeGreaterThan(5);
    numbers.forEach((n, i) => expect(n).toBe(i + 1));
  });
});
