import { describe, it, expect } from 'vitest';
import { renderStatusLine, compactStatus, fmtTokens, fmtDuration, fmtCost, estimateCost } from '../status-line.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatters', () => {
  it('formats tokens compactly', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1_500)).toBe('1.5k');
    expect(fmtTokens(2_000_000)).toBe('2.0M');
  });

  it('formats durations', () => {
    expect(fmtDuration(9_000)).toBe('9s');
    expect(fmtDuration(65_000)).toBe('1m05s');
    expect(fmtDuration(3_700_000)).toBe('1h01m');
  });

  it('formats cost with enough precision to see small spend', () => {
    expect(fmtCost(0)).toBe('$0.00');
    expect(fmtCost(0.0042)).toBe('$0.0042');
    expect(fmtCost(1.5)).toBe('$1.50');
  });
});

describe('estimateCost', () => {
  it('prices known models per million tokens', () => {
    // Opus is $15/M in, $75/M out: 1M of each is $90, not $90,000.
    expect(estimateCost(1_000_000, 1_000_000, 'claude-opus-4')).toBeCloseTo(90, 2);
    expect(estimateCost(10_000, 2_000, 'claude-sonnet-4')).toBeCloseTo(0.06, 4);
  });

  it('returns null for unknown or local models instead of inventing a number', () => {
    expect(estimateCost(1_000, 1_000, 'some-local-llama')).toBeNull();
    expect(estimateCost(1_000, 1_000, undefined)).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(estimateCost(1_000_000, 0, 'CLAUDE-SONNET-4')).toBeCloseTo(3, 4);
  });
});

describe('renderStatusLine', () => {
  it('shows model, context gauge, and cost', () => {
    const out = strip(
      renderStatusLine({
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        usedTokens: 40_000,
        contextWindow: 200_000,
        costUsd: 0.42,
        elapsedMs: 12_000,
        toolCalls: 7,
        filesTouched: 3,
      })
    );
    expect(out).toContain('anthropic/claude-sonnet-4');
    expect(out).toContain('40.0k/200.0k');
    expect(out).toContain('20%');
    expect(out).toContain('$0.42');
    expect(out).toContain('12s');
    expect(out).toContain('7 tools');
    expect(out).toContain('3 files');
  });

  it('flags an active failover', () => {
    const out = strip(renderStatusLine({ model: 'm', failover: 'primary -> backup (1 failover)' }));
    expect(out).toContain('↻');
    expect(out).toContain('primary -> backup');
  });

  it('shows queued prompts', () => {
    expect(strip(renderStatusLine({ model: 'm', queued: 2 }))).toContain('2 queued');
  });

  it('degrades gracefully with almost no state', () => {
    expect(strip(renderStatusLine({}))).toBe('  ');
    expect(strip(renderStatusLine({ model: 'm' }))).toContain('m');
  });

  it('never reports more than 100% context', () => {
    expect(strip(renderStatusLine({ usedTokens: 500_000, contextWindow: 100_000 }))).toContain('100%');
  });

  it('omits the provider prefix when it equals the model', () => {
    const out = strip(renderStatusLine({ model: 'gpt-4o', provider: 'gpt-4o' }));
    expect(out).not.toContain('gpt-4o/gpt-4o');
  });
});

describe('compactStatus', () => {
  it('is a single line with the essentials', () => {
    const out = strip(
      compactStatus({ model: 'm', usedTokens: 90_000, contextWindow: 100_000, toolCalls: 3, failover: 'x' })
    );
    expect(out).toContain('90% ctx');
    expect(out).toContain('3 tools');
    expect(out).toContain('failover');
    expect(out).not.toContain('\n');
  });
});

describe('approval bypass badge', () => {
  const stripAnsi = strip;
  const base = { model: 'gpt-4o', usedTokens: 1000, contextWindow: 128_000 };

  it('leads the status line so truncation cannot hide it', () => {
    const line = renderStatusLine({ ...base, bypass: 'ALLOW-ALL' });
    expect(stripAnsi(line)).toMatch(/^\s*⚡ ALLOW-ALL/);
  });

  it('renders a scoped badge verbatim', () => {
    expect(stripAnsi(renderStatusLine({ ...base, bypass: 'ALLOW-ALL:writes' }))).toContain('ALLOW-ALL:writes');
  });

  it('is absent when no bypass is active', () => {
    expect(stripAnsi(renderStatusLine({ ...base, bypass: null }))).not.toContain('⚡');
    expect(stripAnsi(renderStatusLine(base))).not.toContain('⚡');
  });

  it('also appears in the compact form used for prompt prefixes', () => {
    expect(compactStatus({ ...base, bypass: 'YOLO' })).toContain('⚡ YOLO');
    expect(compactStatus(base)).not.toContain('⚡');
  });
});
