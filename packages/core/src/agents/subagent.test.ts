import { describe, it, expect } from 'vitest';
import type { Message } from '../agent/context.js';
import { SUBAGENTS, extractReport, renderSubAgentResult, subAgentToolsets } from './subagent.js';

describe('SUBAGENTS presets', () => {
  it('gives an explore agent no write capability', () => {
    // A search sub-agent that can write is a liability: it has no view of the
    // parent's plan and can clobber work in progress.
    expect(SUBAGENTS.explore.canWrite).toBe(false);
    expect(SUBAGENTS.explore.toolsets).not.toContain('terminal');
  });

  it('bounds every sub-agent iteration count', () => {
    for (const def of Object.values(SUBAGENTS)) {
      expect(def.maxIterations).toBeGreaterThan(0);
      expect(def.maxIterations).toBeLessThanOrEqual(50);
      expect(def.preamble.length).toBeGreaterThan(50);
    }
  });

  it('restricts the general agent to known toolsets', () => {
    for (const ts of SUBAGENTS.general.toolsets) {
      expect(['files', 'terminal', 'git', 'web', 'agent', 'memory', 'skills']).toContain(ts);
    }
  });

  it('exposes toolsets by kind and tolerates an unknown kind', () => {
    expect(subAgentToolsets('explore')).toEqual(SUBAGENTS.explore.toolsets);
    expect(subAgentToolsets('nope' as never)).toEqual([]);
  });
});

describe('extractReport', () => {
  const m = (role: Message['role'], content: string): Message => ({ role, content });

  it('takes the last assistant message', () => {
    expect(extractReport([m('user', 'q'), m('assistant', 'first'), m('assistant', 'final')])).toBe('final');
  });

  it('skips empty assistant turns (tool-call-only turns)', () => {
    expect(extractReport([m('assistant', 'real answer'), m('assistant', '   ')])).toBe('real answer');
  });

  it('returns empty when the child said nothing', () => {
    expect(extractReport([m('user', 'q')])).toBe('');
    expect(extractReport([])).toBe('');
  });
});

describe('renderSubAgentResult', () => {
  it('states that the child tokens were not charged to the parent context', () => {
    // This is the whole point of delegation, and the parent model needs to be
    // told it is not being charged for the child's exploration.
    const out = renderSubAgentResult({
      ok: true,
      kind: 'explore',
      report: 'Found it in src/a.ts:12',
      reportChars: 22,
      childTokens: 48_000,
      toolCalls: 9,
      iterations: 6,
    });
    expect(out).toContain('src/a.ts:12');
    expect(out).toContain('48000 tokens spent in an isolated context');
    expect(out).toContain('9 tool calls');
  });

  it('renders failures as a plain, actionable string rather than throwing', () => {
    const out = renderSubAgentResult({
      ok: false,
      kind: 'general',
      report: '',
      reportChars: 0,
      childTokens: 0,
      toolCalls: 0,
      iterations: 0,
      error: 'provider rate limited',
    });
    expect(out).toContain('failed');
    expect(out).toContain('provider rate limited');
  });

  it('handles an empty report without producing a blank block', () => {
    const out = renderSubAgentResult({
      ok: true,
      kind: 'explore',
      report: '',
      reportChars: 0,
      childTokens: 0,
      toolCalls: 1,
      iterations: 1,
    });
    expect(out).toContain('no text report');
  });
});
