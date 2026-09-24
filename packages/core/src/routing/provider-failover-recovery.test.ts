import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRouter } from './provider-router.js';
import { RateLimitError, AuthError } from '../errors.js';

/**
 * Provider failover must recover.
 *
 * Regression: _currentIndex was only ever written on success, and
 * getEligibleProviders rotated the list so _currentIndex came first. One
 * transient failure (a single ECONNRESET, a 45s timeout, one 500) therefore
 * moved the sticky pointer to a fallback and the primary was never revisited
 * for the rest of the session, even though nothing was wrong with it. Users
 * saw MyCode silently drop to a weaker model and stay there.
 *
 * Eligibility is now driven by per-provider cooldowns that expire on their own,
 * and the provider list is always walked in configured priority order.
 */

function fake(name: string, behaviour: () => any) {
  const p: any = {
    name,
    model: `${name}-model`,
    canRead: true,
    canWrite: true,
    _health: { successCount: 0, failureCount: 0, isAvailable: true, cooldownUntil: 0 },
    chat: behaviour,
    stream: async function* () {},
  };
  p.recordSuccess = function () {
    this._health.successCount++;
    this._health.failureCount = 0;
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
  };
  p.recordFailure = function (ms = 30_000) {
    this._health.failureCount++;
    this._health.cooldownUntil = Date.now() + ms;
  };
  p.isReady = function (now = Date.now()) {
    return this._health.isAvailable && now >= this._health.cooldownUntil;
  };
  p.resetCooldown = function () {
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
  };
  p.getHealth = function () {
    return { ...this._health };
  };
  return p;
}

function routerWith(providers: any[]): any {
  const r: any = new ProviderRouter([
    { name: 'seed', apiProvider: 'custom', baseUrl: 'http://localhost:1/v1', model: 'seed', apiKey: 'k', priority: 0 },
  ] as any);
  r.providers = providers;
  return r;
}

describe('provider failover recovery', () => {
  let calls: string[];
  let primaryFails: boolean;

  beforeEach(() => {
    calls = [];
    primaryFails = false;
  });

  const make = (primaryError: () => Error = () => new Error('ECONNRESET')) => {
    const A = fake('primary', async () => {
      calls.push('primary');
      if (primaryFails) throw primaryError();
      return { content: 'from primary' };
    });
    const B = fake('fallback', async () => {
      calls.push('fallback');
      return { content: 'from fallback' };
    });
    return { A, B, router: routerWith([A, B]) };
  };

  it('falls over on a transient error', async () => {
    primaryFails = true;
    const { router } = make();
    const r = await router.chat([], undefined, {});
    expect(r.content).toBe('from fallback');
    expect(calls).toEqual(['primary', 'fallback']);
  });

  it('stays on the fallback only while the cooldown is live', async () => {
    primaryFails = true;
    const { A, router } = make();
    await router.chat([], undefined, {});

    primaryFails = false; // the blip is over
    calls.length = 0;

    await router.chat([], undefined, {});
    expect(calls).toEqual(['fallback']); // still cooling down — correct
    expect(A.getHealth().cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('THE FIX: returns to the primary once the cooldown expires', async () => {
    primaryFails = true;
    const { A, router } = make();
    await router.chat([], undefined, {});
    expect(router.getCurrentProvider().name).toBe('fallback');

    primaryFails = false;
    A._health.cooldownUntil = Date.now() - 1; // simulate the cooldown elapsing
    calls.length = 0;

    const r = await router.chat([], undefined, {});
    expect(calls).toEqual(['primary']);
    expect(r.content).toBe('from primary');
    expect(router.getCurrentProvider().name).toBe('primary');
  });

  it('a success clears the cooldown immediately', async () => {
    const { A } = make();
    A.recordFailure(60_000);
    expect(A.isReady()).toBe(false);
    A.recordSuccess();
    expect(A.isReady()).toBe(true);
    expect(A.getHealth().failureCount).toBe(0);
  });

  it('rate limits park for the server-supplied Retry-After', async () => {
    primaryFails = true;
    const { A, router } = make(() => new RateLimitError('primary', 5_000));
    await router.chat([], undefined, {});
    const parked = A.getHealth().cooldownUntil - Date.now();
    expect(parked).toBeGreaterThan(3_000);
    expect(parked).toBeLessThanOrEqual(5_000);
    expect(router).toBeTruthy();
  });

  it('auth failures park far longer than transient ones', async () => {
    primaryFails = true;
    const { A, router } = make(() => new AuthError('primary'));
    await router.chat([], undefined, {});
    const parked = A.getHealth().cooldownUntil - Date.now();
    expect(parked).toBeGreaterThan(9 * 60_000);
  });

  it('honours configured priority order rather than the last success', async () => {
    const served: string[] = [];
    const A = fake('a', async () => {
      served.push('a');
      return { content: 'a' };
    });
    const B = fake('b', async () => {
      served.push('b');
      return { content: 'b' };
    });
    const C = fake('c', async () => {
      served.push('c');
      return { content: 'c' };
    });
    const router = routerWith([A, B, C]);

    // A is unhealthy; B serves and becomes "current".
    A.recordFailure(60_000);
    expect((await router.chat([], undefined, {})).content).toBe('b');
    expect(router.getCurrentProvider().name).toBe('b');

    // Next request must still start from the highest-priority ready provider (B),
    // not from wherever the last success happened to leave the pointer.
    served.length = 0;
    expect((await router.chat([], undefined, {})).content).toBe('b');
    expect(served).toEqual(['b']);

    // Once A recovers it is preferred again, ahead of B and C.
    A.resetCooldown();
    served.length = 0;
    expect((await router.chat([], undefined, {})).content).toBe('a');
    expect(served).toEqual(['a']);
  });
});
