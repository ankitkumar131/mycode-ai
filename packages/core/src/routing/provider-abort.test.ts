import { describe, it, expect } from 'vitest';
import { ProviderRouter } from './provider-router.js';
import { AllProvidersExhaustedError, RateLimitError } from '../errors.js';

/**
 * Ctrl+C must stop the turn, not walk the chain.
 *
 * Regression: neither failover loop consulted the abort signal. The abort error
 * was caught, recorded as a provider failure (parking a healthy provider on a
 * cooldown), logged as "Switching X -> Y (Request aborted)", and the loop moved
 * to the next provider. One interrupt therefore burned every remaining provider
 * and ended in "All providers failed" — after which the aborted providers were
 * all on cooldown for no reason.
 */

function make(name: string, behaviour: () => any) {
  const p: any = {
    name,
    model: `${name}-model`,
    canRead: true,
    canWrite: true,
    _health: { successCount: 0, failureCount: 0, isAvailable: true, cooldownUntil: 0, lastError: undefined },
    chat: behaviour,
    stream: async function* () {},
  };
  p.recordSuccess = function () {
    this._health.successCount++;
    this._health.failureCount = 0;
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
  };
  p.recordFailure = function (ms = 30_000, msg?: string) {
    this._health.failureCount++;
    this._health.cooldownUntil = Date.now() + ms;
    if (msg) this._health.lastError = msg;
  };
  p.isReady = function (now = Date.now()) {
    return this._health.isAvailable && now >= this._health.cooldownUntil;
  };
  p.resetCooldown = function () {
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
  };
  return p;
}

function routerWith(names: string[]) {
  const router = new ProviderRouter(
    names.map((n) => ({ name: n, apiProvider: 'openai', model: 'm', apiKey: 'k' }))
  );
  (router as any).providers = names.map((n) => make(n, async () => ({ content: 'ok' })));
  return router;
}

describe('abort stops failover', () => {
  it('calls no provider at all when the turn is already cancelled', async () => {
    const tried: string[] = [];
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'b', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'c', apiProvider: 'openai', model: 'm', apiKey: 'k' },
    ]);
    (router as any).providers = ['a', 'b', 'c'].map((n) =>
      make(n, async () => {
        tried.push(n);
        return { content: 'ok' };
      })
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      router.chat([{ role: 'user', content: 'hi' }], [], { abortSignal: controller.signal })
    ).rejects.toThrow();

    expect(tried).toEqual([]);
  });

  it('stops mid-chain when the cancel lands during the first call', async () => {
    // This is the real Ctrl+C case: the request is already in flight when the
    // user interrupts, so provider A does get called — but B must not be.
    const tried: string[] = [];
    let controller: AbortController;
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'b', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'c', apiProvider: 'openai', model: 'm', apiKey: 'k' },
    ]);
    controller = new AbortController();
    (router as any).providers = ['a', 'b', 'c'].map((n) =>
      make(n, async () => {
        tried.push(n);
        if (n === 'a') {
          // Simulate the in-flight request being cancelled.
          controller.abort();
          const err: any = new Error('Request aborted');
          err.name = 'AbortError';
          throw err;
        }
        return { content: 'ok' };
      })
    );

    await expect(
      router.chat([{ role: 'user', content: 'hi' }], [], { abortSignal: controller.signal })
    ).rejects.toThrow();

    expect(tried).toEqual(['a']);
  });

  it('does not park the aborted provider on a cooldown', async () => {
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'b', apiProvider: 'openai', model: 'm', apiKey: 'k' },
    ]);
    const a = make('a', async () => {
      const err: any = new Error('Request aborted');
      err.name = 'AbortError';
      throw err;
    });
    const b = make('b', async () => ({ content: 'ok' }));
    (router as any).providers = [a, b];

    const controller = new AbortController();
    controller.abort();
    await expect(
      router.chat([{ role: 'user', content: 'hi' }], [], { abortSignal: controller.signal })
    ).rejects.toThrow();

    // A healthy provider must not be skipped next turn just because the user
    // pressed Ctrl+C during this one.
    expect(a._health.failureCount).toBe(0);
    expect(a._health.cooldownUntil).toBe(0);
    expect(a.isReady()).toBe(true);
  });

  it('still reports a genuine exhaustion when nothing was aborted', async () => {
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'b', apiProvider: 'openai', model: 'm', apiKey: 'k' },
    ]);
    (router as any).providers = [
      make('a', async () => {
        throw new RateLimitError('a', null);
      }),
      make('b', async () => {
        throw new RateLimitError('b', null);
      }),
    ];

    await expect(router.chat([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(
      AllProvidersExhaustedError
    );
  });

  it('a non-abort failure still advances to the next provider', async () => {
    const tried: string[] = [];
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'm', apiKey: 'k' },
      { name: 'b', apiProvider: 'openai', model: 'm', apiKey: 'k' },
    ]);
    (router as any).providers = [
      make('a', async () => {
        tried.push('a');
        throw new RateLimitError('a', null);
      }),
      make('b', async () => {
        tried.push('b');
        return { content: 'ok' };
      }),
    ];

    const result = await router.chat([{ role: 'user', content: 'hi' }], []);
    expect(result.content).toBe('ok');
    expect(tried).toEqual(['a', 'b']);
  });

  it('aborts a stream without emitting anything from later providers', async () => {
    const router = routerWith(['a', 'b']);
    const a = make('a', async function* () {
      const err: any = new Error('Request aborted');
      err.name = 'AbortError';
      throw err;
    });
    (router as any).providers = [a, make('b', async function* () { yield { content: 'x' }; })];

    const controller = new AbortController();
    controller.abort();

    const seen: any[] = [];
    await expect(
      (async () => {
        for await (const chunk of router.stream([], [], { abortSignal: controller.signal })) {
          seen.push(chunk);
        }
      })()
    ).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
