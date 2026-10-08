import { describe, it, expect } from 'vitest';
import type { Message } from '../agent/context.js';
import {
  DEFAULT_COMPACTION,
  resolveSettings,
  estimateTokens,
  shouldCompact,
  planCompaction,
  pruneStaleToolOutput,
  applySummary,
  findPreviousSummary,
  buildSummaryPrompt,
  serializeForSummary,
  SUMMARY_MARKER,
  ROLL_FORWARD_INSTRUCTIONS,
} from './compaction.js';

const user = (content: string): Message => ({ role: 'user', content });
const assistant = (content: string): Message => ({ role: 'assistant', content });
const toolResult = (content: string): Message => ({
  role: 'tool',
  content,
  tool_call_id: 'c1',
  name: 'bash',
});

/** A message whose serialised length is roughly `tokens * 4` characters. */
const big = (role: Message['role'], tokens: number): Message => ({
  role,
  content: 'x'.repeat(Math.max(0, tokens * 4 - 40)),
});

describe('shouldCompact', () => {
  it('does nothing well below the window', () => {
    expect(shouldCompact(10_000, 200_000)).toBe(false);
  });

  it('triggers once the headroom buffer is consumed', () => {
    const window = 200_000;
    const { buffer } = DEFAULT_COMPACTION;
    expect(shouldCompact(window - buffer, window)).toBe(false);
    expect(shouldCompact(window - buffer + 1, window)).toBe(true);
  });

  it('respects a per-session buffer', () => {
    // 100k window with a 20k buffer compacts above 80k.
    expect(shouldCompact(80_000, 100_000, { buffer: 20_000 })).toBe(false);
    expect(shouldCompact(80_001, 100_000, { buffer: 20_000 })).toBe(true);
  });

  it('has a floor so a tiny window does not compress on every turn', () => {
    expect(shouldCompact(500, 1_000)).toBe(false);
  });

  it('can be disabled', () => {
    expect(shouldCompact(999_999, 100_000, { auto: false })).toBe(false);
  });
});

describe('estimateTokens', () => {
  it('scales with serialised size', () => {
    const small = estimateTokens([user('hi')]);
    const large = estimateTokens([user('x'.repeat(4_000))]);
    expect(large).toBeGreaterThan(small + 900);
  });
});

describe('planCompaction', () => {
  it('keeps the tail within the token budget', () => {
    const messages = [
      user('objective: fix the failing test'),
      ...Array.from({ length: 60 }, (_, i) => assistant(`step ${i} ${'y'.repeat(2_000)}`)),
    ];
    const plan = planCompaction(messages, { keepTokens: 4_000 });
    expect(plan.reason).toBe('threshold');
    expect(plan.tokensKept).toBeLessThanOrEqual(6_000);
    expect(plan.older.length).toBeGreaterThan(0);
    expect(plan.recent.length).toBeGreaterThan(0);
    expect(plan.tokensBefore).toBeGreaterThan(plan.tokensKept);
  });

  it('always preserves system messages outside the summary region', () => {
    const messages: Message[] = [
      { role: 'system', content: 'you are mycode' },
      user('task'),
      ...Array.from({ length: 40 }, () => big('assistant', 500)),
    ];
    const plan = planCompaction(messages, { keepTokens: 2_000 });
    expect(plan.older.some((m) => m.role === 'system')).toBe(false);
    expect(plan.recent.some((m) => m.role === 'system')).toBe(false);
  });

  it('never orphans a tool result at the head of the kept tail', () => {
    // Recent region would naturally begin on the tool result; it must be moved
    // into the summarised region instead, or the provider rejects the payload.
    const messages: Message[] = [user('go'), toolResult('x'.repeat(400)), assistant('done')];
    const plan = planCompaction(messages, { keepTokens: 5 });
    expect(plan.recent[0]?.role).not.toBe('tool');
  });

  it('reports no-op when there is nothing meaningful to summarise', () => {
    const plan = planCompaction([user('only message')], { keepTokens: 8_000 });
    expect(plan.reason).toBe('no-op');
    expect(plan.older.length).toBeLessThan(2);
  });

  it('is a no-op for an empty conversation', () => {
    const plan = planCompaction([]);
    expect(plan.reason).toBe('no-op');
    expect(plan.recent).toEqual([]);
  });

  it('honours an explicit keepTokens override (the /compact N path)', () => {
    const messages = Array.from({ length: 50 }, () => big('assistant', 1_000));
    const tight = planCompaction(messages, { keepTokens: 2_000 });
    const loose = planCompaction(messages, { keepTokens: 40_000 });
    expect(loose.recent.length).toBeGreaterThan(tight.recent.length);
  });
});

describe('pruneStaleToolOutput', () => {
  it('stubs oversized tool results in the summarised region', () => {
    // keepFromIndex = messages.length prunes every message in the region, which
    // is exactly how planCompaction calls it.
    const messages = [toolResult('z'.repeat(10_000)), user('next')];
    const { messages: out, pruned } = pruneStaleToolOutput(messages, messages.length, 500);
    expect(pruned).toBe(1);
    expect(out[0].content.length).toBeLessThan(1_000);
    expect(out[0].content).toContain('pruned');
    expect(out[1].content).toBe('next');
  });

  it('leaves small tool results alone', () => {
    const messages = [toolResult('short')];
    const { pruned } = pruneStaleToolOutput(messages, messages.length, 500);
    expect(pruned).toBe(0);
  });

  it('does not prune non-tool messages', () => {
    const messages = [user('u'.repeat(10_000))];
    const { pruned } = pruneStaleToolOutput(messages, messages.length, 500);
    expect(pruned).toBe(0);
  });

  it('never touches messages at or after keepFromIndex', () => {
    const messages = [toolResult('a'.repeat(10_000)), toolResult('b'.repeat(10_000))];
    const { messages: out, pruned } = pruneStaleToolOutput(messages, 1, 500);
    expect(pruned).toBe(1);
    expect(out[1].content.length).toBe(10_000);
  });
});

describe('summary prompt', () => {
  it('injects the live todo list so the plan survives compaction', () => {
    const prompt = buildSummaryPrompt({
      transcript: serializeForSummary([user('do the thing')]),
      todos: [
        { content: 'step one', status: 'completed' },
        { content: 'step two', status: 'pending' },
      ],
    });
    expect(prompt).toContain('step one');
    expect(prompt).toContain('step two');
    expect(prompt).toContain('Objective');
  });

  it('includes roll-forward instructions and the prior summary when present', () => {
    const prompt = buildSummaryPrompt({
      transcript: serializeForSummary([user('newest work')]),
      previousSummary: '## Objective\nOld goal',
    });
    expect(prompt).toContain('newest work');
    expect(prompt).toContain('Old goal');
    expect(prompt).toContain(ROLL_FORWARD_INSTRUCTIONS.slice(0, 40));
  });

  it('omits the roll-forward section for a first compaction', () => {
    const prompt = buildSummaryPrompt({ transcript: serializeForSummary([user('first')]) });
    expect(prompt).not.toContain('prior-summary');
    expect(prompt).toContain('Objective');
  });

  it('truncates an enormous transcript to the character budget', () => {
    const prompt = buildSummaryPrompt({
      transcript: 't'.repeat(50_000),
      totalChars: 1_000,
    });
    expect(prompt.length).toBeLessThan(5_000);
  });

  it('serializeForSummary caps per-message length', () => {
    const out = serializeForSummary([user('q'.repeat(50_000))], 1_000);
    expect(out.length).toBeLessThan(2_000);
  });
});

describe('applySummary / findPreviousSummary', () => {
  it('replaces the middle with a marked user turn plus an ack', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      user('old'),
      assistant('old reply'),
      user('recent'),
    ];
    const out = applySummary(messages, '## Objective\nShip it', [user('recent')]);
    expect(out[0].role).toBe('system');
    expect(out[1].role).toBe('user');
    expect(out[1].content).toContain(SUMMARY_MARKER);
    expect(out[2].role).toBe('assistant');
    expect(out[out.length - 1].content).toBe('recent');
    // The summarised content is gone from history.
    expect(out.some((m) => m.content === 'old')).toBe(false);
  });

  it('round-trips a summary through findPreviousSummary', () => {
    const applied = applySummary([], '## Objective\nShip it', []);
    expect(findPreviousSummary(applied)).toBe('## Objective\nShip it');
  });

  it('returns undefined when no summary exists', () => {
    expect(findPreviousSummary([user('hello')])).toBeUndefined();
  });

  it('rolls forward: a second compaction can recover the first summary', () => {
    const first = applySummary([user('a')], 'first summary', [user('b')]);
    const recovered = findPreviousSummary(first);
    expect(recovered).toBe('first summary');
    const second = applySummary(first, 'merged summary', [user('c')]);
    expect(findPreviousSummary(second)).toBe('merged summary');
    expect(second.some((m) => m.content.includes('first summary'))).toBe(false);
  });
});

describe('resolveSettings', () => {
  it('merges overrides over defaults', () => {
    const s = resolveSettings({ buffer: 1 });
    expect(s.buffer).toBe(1);
    expect(s.keepTokens).toBe(DEFAULT_COMPACTION.keepTokens);
  });
});
