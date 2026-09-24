import { describe, it, expect } from 'vitest';
import { ProviderRouter } from './provider-router.js';
import { ProviderGoneError, AuthError } from '../errors.js';

/**
 * `getStats()` must tell the truth about provider health.
 *
 * Regression: status was derived from `_health.isAvailable`, a field that is
 * only ever written as `true`. Every provider therefore reported 'active'
 * forever — including ones returning HTTP 410 — and `priority` was hardcoded
 * to 0. `mycode config test` printed that value, so the one command a user
 * runs to find out which of their providers actually work reported all of them
 * as healthy. A diagnostic that cannot fail is worse than no diagnostic.
 *
 * Status now comes from the cooldown window via `isReady()`, and priority is
 * carried through from the configured value.
 */

/** Build a router whose providers are fakes we can fail on demand. */
function routerWith(configs: any[]) {
  const router = new ProviderRouter(configs);
  const providers: any[] = (router as any).providers;
  return { router, providers };
}

const base = (extra: any = {}) => ({
  apiProvider: 'openai',
  model: 'm',
  apiKey: 'k',
  ...extra,
});

describe('getStats truthfulness', () => {
  it('reports a fresh provider as active', () => {
    const { router } = routerWith([base({ name: 'p1' })]);
    const [s] = router.getStats();
    expect(s.status).toBe('active');
    expect(s.cooldownRemainingMs).toBe(0);
  });

  it('reports the configured priority instead of 0', () => {
    const { router } = routerWith([
      base({ name: 'a' }),
      base({ name: 'b', priority: 7 }),
    ]);
    const byName = Object.fromEntries(router.getStats().map((s) => [s.name, s]));
    expect(byName.b.priority).toBe(7);
    // Undefined priority defaults to 99, not 0.
    expect(byName.a.priority).toBe(99);
  });

  it('reports a provider inside its cooldown as error, not active', () => {
    const { router, providers } = routerWith([
      base({ name: 'primary', priority: 1 }),
      base({ name: 'backup', priority: 2 }),
    ]);
    // Primary fails with a permanent error -> parked.
    providers[0].recordFailure(60 * 60_000, 'endpoint is gone (HTTP 410)');

    const stats = router.getStats();
    const primary = stats.find((s) => s.name === 'primary')!;
    expect(primary.status).toBe('error');
    expect(primary.cooldownRemainingMs).toBeGreaterThan(0);
    expect(primary.lastError).toContain('410');

    const backup = stats.find((s) => s.name === 'backup')!;
    expect(backup.status).not.toBe('error');
  });

  it('clears the error once the cooldown expires', () => {
    const { router, providers } = routerWith([base({ name: 'p1' })]);
    providers[0].recordFailure(30_000, 'transient');
    expect(router.getStats()[0].status).toBe('error');

    providers[0].resetCooldown();
    const [s] = router.getStats();
    expect(s.status).toBe('active');
    expect(s.cooldownRemainingMs).toBe(0);
  });

  it('clears the recorded error on success', () => {
    const { router, providers } = routerWith([base({ name: 'p1' })]);
    providers[0].recordFailure(60_000, 'boom');
    expect(router.getStats()[0].lastError).toBe('boom');
    providers[0].recordSuccess();
    expect(router.getStats()[0].lastError).toBeUndefined();
    expect(router.getStats()[0].status).toBe('active');
  });

  it('survives a provider whose fake never records lastError', () => {
    // Older fakes omit lastError; stats must not throw or print "undefined".
    const { router } = routerWith([base({ name: 'p1' })]);
    expect(() => router.getStats()).not.toThrow();
  });
});

describe('ProviderGoneError classification', () => {
  it('is distinct from a server error so the cooldown differs', () => {
    const gone = new ProviderGoneError('nvidia/llama', 410);
    expect(gone.statusCode).toBe(410);
    expect(gone.name).toBe('ProviderGoneError');
    expect(gone.message).toContain('removed upstream');
  });

  it('is not an AuthError even though both are "permanent"', () => {
    const gone = new ProviderGoneError('p', 404);
    expect(gone instanceof AuthError).toBe(false);
  });
});
