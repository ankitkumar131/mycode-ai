import { describe, it, expect, vi } from 'vitest';
import { FailoverCoordinator, effectiveWindowFor, safeContextWindow, describeFailoverReason } from './failover.js';
import type { ProviderConfig } from './types.js';

const provider = (name: string, model: string, contextWindow?: number): ProviderConfig => ({
  name,
  apiProvider: name,
  model,
  ...(contextWindow ? { contextWindow } : {}),
});

describe('effectiveWindowFor', () => {
  it('prefers an explicit contextWindow over inference', () => {
    // Guessing a model name wrong is how a session overflows mid-task.
    expect(effectiveWindowFor(provider('p', 'claude-sonnet-4', 32_000))).toBe(32_000);
  });

  it('consults a caller-supplied table before its built-in hints', () => {
    expect(effectiveWindowFor(provider('p', 'my-finetune-v2'), { 'finetune-v2': 64_000 })).toBe(64_000);
  });

  it('infers a large window for known long-context models', () => {
    expect(effectiveWindowFor(provider('p', 'gemini-2.5-pro'))).toBe(1_000_000);
    expect(effectiveWindowFor(provider('p', 'claude-sonnet-4-5'))).toBe(200_000);
    expect(effectiveWindowFor(provider('p', 'gpt-4o'))).toBe(128_000);
  });

  it('falls back rather than throwing on an unknown model', () => {
    expect(effectiveWindowFor(provider('p', 'mystery-model'), {}, 42_000)).toBe(42_000);
  });

  it('ignores a nonsense explicit window', () => {
    expect(effectiveWindowFor(provider('p', 'gpt-4o', 0))).toBe(128_000);
    expect(effectiveWindowFor(provider('p', 'gpt-4o', -5))).toBe(128_000);
  });
});

describe('safeContextWindow', () => {
  it('returns the smallest window in the chain', () => {
    // Compacting against the strongest provider is how a failover to the
    // weakest one overflows the moment it takes over.
    const chain = [
      provider('a', 'gemini-2.5-pro'),      // 1M
      provider('b', 'gpt-4o'),              // 128k
      provider('c', 'local', 8_000),        // explicit
    ];
    expect(safeContextWindow(chain)).toBe(8_000);
  });

  it('is safe for an empty or single-provider chain', () => {
    expect(safeContextWindow([])).toBe(128_000);
    expect(safeContextWindow([provider('a', 'gpt-4o')])).toBe(128_000);
  });
});

describe('describeFailoverReason', () => {
  it.each([
    [{ statusCode: 429 }, 'rate limited'],
    [{ message: 'You have exceeded your rate limit' }, 'rate limited'],
    [{ statusCode: 401 }, 'authentication failed'],
    [{ message: 'invalid api key' }, 'authentication failed'],
    [{ message: 'maximum context length exceeded' }, 'context window exceeded'],
    [{ statusCode: 503 }, 'provider server error (503)'],
    [{ message: 'fetch failed' }, 'connection failed'],
    [{ message: 'ECONNREFUSED 127.0.0.1:11434' }, 'connection failed'],
    [{ message: 'model not found' }, 'model unavailable'],
    [{ message: 'provider is overloaded' }, 'provider overloaded'],
  ])('maps %j to "%s"', (err, expected) => {
    expect(describeFailoverReason(err)).toBe(expected);
  });

  it('recognises typed provider errors by name, not instanceof', () => {
    // A duplicated module instance would break instanceof; the name check is
    // what keeps the user-visible reason accurate.
    const rate = Object.assign(new Error('Rate limit exceeded for provider: primary'), { name: 'RateLimitError' });
    expect(describeFailoverReason(rate)).toBe('rate limited');
    const auth = Object.assign(new Error('Authentication failed'), { name: 'AuthError' });
    expect(describeFailoverReason(auth)).toBe('authentication failed');
    const ctx = Object.assign(new Error('Context length exceeded'), { name: 'ContextLengthError' });
    expect(describeFailoverReason(ctx)).toBe('context window exceeded');
    const server = Object.assign(new Error('Server error'), { name: 'ProviderServerError', statusCode: 502 });
    expect(describeFailoverReason(server)).toBe('provider server error (502)');
  });

  it('never throws on a non-error value', () => {
    expect(describeFailoverReason(null)).toBe('unknown error');
    expect(describeFailoverReason(undefined)).toBe('unknown error');
  });
});

describe('FailoverCoordinator', () => {
  const chain = [provider('primary', 'gpt-4o'), provider('backup', 'claude-sonnet-4-5', 200_000)];

  it('does not report a failover when the provider is unchanged', async () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    expect(await c.observe('primary')).toBeNull();
    expect(c.count).toBe(0);
  });

  it('records a switch, announces it, and checkpoints first', async () => {
    const order: string[] = [];
    const c = new FailoverCoordinator({
      providers: chain,
      onAnnounce: (e) => order.push(`announce:${e.to}`),
      onCheckpoint: async () => {
        order.push('checkpoint');
      },
    });
    c.prime('primary');

    const event = await c.observe('backup', { reason: 'rate limited', sessionId: 's1' });
    expect(event).toMatchObject({ from: 'primary', to: 'backup', reason: 'rate limited' });
    // The checkpoint must run before the announcement so no work is lost if the
    // announcement handler (or the next request) fails.
    expect(order).toEqual(['checkpoint', 'announce:backup']);
    expect(c.count).toBe(1);
  });

  it('does not checkpoint when no session id is supplied', async () => {
    const onCheckpoint = vi.fn();
    const c = new FailoverCoordinator({ providers: chain, onCheckpoint });
    c.prime('primary');
    await c.observe('backup', { reason: 'x' });
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it('survives a throwing checkpoint or announcer', async () => {
    const c = new FailoverCoordinator({
      providers: chain,
      onCheckpoint: () => {
        throw new Error('disk full');
      },
      onAnnounce: () => {
        throw new Error('renderer died');
      },
    });
    c.prime('primary');
    await expect(c.observe('backup', { sessionId: 's1' })).resolves.toMatchObject({ to: 'backup' });
    expect(c.count).toBe(1);
  });

  it('primes without recording an event', () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    expect(c.count).toBe(0);
    expect(c.current).toBe('primary');
  });

  it('reports the handoff brief only after a real failover', async () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    expect(c.buildHandoffBrief()).toBeNull();

    await c.observe('backup', { reason: 'rate limited' });
    const brief = c.buildHandoffBrief()!;
    expect(brief).toContain('primary');
    expect(brief).toContain('backup');
    expect(brief).toContain('rate limited');
    expect(brief).toContain('Do not restart completed work');
  });

  it('notes the cumulative count on repeated failovers', async () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    await c.observe('backup');
    await c.observe('primary');
    expect(c.count).toBe(2);
    expect(c.buildHandoffBrief()).toContain('2 times');
  });

  it('summarises the chain of providers for the status line', async () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    await c.observe('backup');
    expect(c.summary()).toBe('primary -> backup (1 failover)');
  });

  it('exposes the safe window for the whole chain', () => {
    const c = new FailoverCoordinator({ providers: chain });
    expect(c.safeWindow).toBe(128_000);
  });

  it('pins the provider per turn so the tool surface cannot shift mid-turn', () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.pinForTurn('primary');
    expect(c.pinnedProvider).toBe('primary');

    // A failover later in the same turn must not change the pinned provider.
    c.pinForTurn('backup');
    expect(c.pinnedProvider).toBe('primary');

    // The next turn re-pins.
    c.setTurn(1);
    c.pinForTurn('backup');
    expect(c.pinnedProvider).toBe('backup');
  });

  it('reset clears the ledger and pin', async () => {
    const c = new FailoverCoordinator({ providers: chain });
    c.prime('primary');
    await c.observe('backup');
    c.pinForTurn('backup');
    c.reset();
    expect(c.count).toBe(0);
    expect(c.current).toBeNull();
    expect(c.buildHandoffBrief()).toBeNull();
  });

  it('tolerates an empty provider list', () => {
    const c = new FailoverCoordinator({});
    expect(c.safeWindow).toBe(128_000);
    expect(c.current).toBeNull();
  });
});
