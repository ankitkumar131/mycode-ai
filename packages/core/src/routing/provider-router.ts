import { BaseProvider } from './base-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama-provider.js';
import {
  RateLimitError,
  AuthError,
  ContextLengthError,
  ProviderServerError,
  ProviderGoneError,
  AllProvidersExhaustedError,
  NoProvidersConfiguredError,
} from '../errors.js';
import { logger } from '../output/logger.js';
import type { ProviderConfig, ProviderStats } from './types.js';

const AUTH_COOLDOWN_MS = 10 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const TRANSIENT_COOLDOWN_MS = 30_000;
const GONE_COOLDOWN_MS = 60 * 60_000;

/**
 * How long to park a provider after a given failure.
 *
 * Everything except a bad credential is treated as transient: 5xx, timeouts,
 * connection resets and context-length errors all clear after a short cooldown
 * so the preferred provider comes back on its own. Rate limits honour the
 * server's Retry-After when one is supplied.
 */
/**
 * True when the caller cancelled the turn.
 *
 * An abort is not a provider failure. Treating it as one both walks the rest of
 * the chain for no reason and parks a perfectly healthy provider on a cooldown,
 * so it has to be recognised before any failure bookkeeping happens.
 */
function isAbort(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err?.name === 'AbortError') return true;
  return /abort/i.test(String(err?.message ?? ''));
}

function abortError(): Error {
  const err = new Error('Request aborted');
  err.name = 'AbortError';
  return err;
}

function cooldownForError(err: Error): number {
  if (err instanceof AuthError) return AUTH_COOLDOWN_MS;
  // A gone endpoint never comes back on its own — park it long so we do not
  // burn a turn on it every cycle, but not forever (models get re-published).
  if (err instanceof ProviderGoneError) return GONE_COOLDOWN_MS;
  if (err instanceof RateLimitError) {
    const retryAfter = err.retryAfterMs;
    if (typeof retryAfter === 'number' && retryAfter > 0) {
      return Math.min(retryAfter, AUTH_COOLDOWN_MS);
    }
    return RATE_LIMIT_COOLDOWN_MS;
  }
  return TRANSIENT_COOLDOWN_MS;
}

export class ProviderRouter {
  private providers: BaseProvider[] = [];
  private _currentIndex = 0;
  /** Configured priority per provider, kept so stats do not have to lie with 0. */
  private priorities = new Map<BaseProvider, number>();

  constructor(configs: ProviderConfig[] = []) {
    if (!configs.length) {
      throw new NoProvidersConfiguredError();
    }
    this.providers = configs
      .slice()
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((c) => {
        const provider = this.createProvider(c);
        this.priorities.set(provider, c.priority ?? 99);
        return provider;
      });
  }

  private createProvider(config: ProviderConfig): BaseProvider {
    switch (config.apiProvider) {
      case 'ollama':
        return new OllamaProvider(config);
      case 'openrouter':
      case 'nvidia_nim':
      case 'openai':
      case 'custom':
      default:
        return new OpenAICompatibleProvider({
          ...config,
          maxOutputTokens: config.maxOutputTokens,
        });
    }
  }

  private getEligibleProviders(requirements: { needsWrite?: boolean; needsRead?: boolean } = {}): BaseProvider[] {
    // Always try in the configured priority order. `this.providers` is already
    // sorted by priority in the constructor.
    //
    // This used to rotate the list so that _currentIndex came first. Combined
    // with _currentIndex only ever being written on success, one transient
    // failure (a single ECONNRESET, a 45s timeout, one 500) moved the sticky
    // pointer to a fallback and the primary was never revisited for the rest of
    // the session — even though nothing was wrong with it. Eligibility is now
    // driven by per-provider cooldowns instead, which expire on their own.
    const now = Date.now();
    return this.providers.filter((p) => {
      if (!p.isReady(now)) return false;
      if (requirements.needsWrite && !p.canWrite) return false;
      if (requirements.needsRead && !p.canRead) return false;
      return true;
    });
  }

  private handleProviderError(provider: BaseProvider, err: Error, remaining: BaseProvider[]): void {
    // A cancelled turn is not a provider fault. Recording it would park a
    // healthy provider on a cooldown, which is the same class of bug as a
    // transient blip demoting the primary — the provider never did anything
    // wrong and would be skipped for no reason.
    if (isAbort(err)) return;

    provider.recordFailure(cooldownForError(err), err.message);

    const idx = remaining.indexOf(provider);
    const nextLabel = idx >= 0 && idx + 1 < remaining.length ? remaining[idx + 1].name : 'none available';

    if (err instanceof RateLimitError) {
      logger.switchProviders(provider.name, nextLabel, 'rate limit');
    } else if (err instanceof AuthError) {
      logger.switchProviders(provider.name, nextLabel, 'auth error \u2014 check API key');
    } else if (err instanceof ContextLengthError) {
      logger.switchProviders(provider.name, nextLabel, 'context too long');
    } else if (err instanceof ProviderServerError) {
      logger.switchProviders(provider.name, nextLabel, `server error (${err.statusCode})`);
    } else if (err instanceof ProviderGoneError) {
      logger.switchProviders(provider.name, nextLabel, `endpoint gone (HTTP ${err.statusCode}) — model removed upstream`);
    } else {
      logger.switchProviders(provider.name, nextLabel, err.message || 'unknown error');
    }
  }

  getCurrentProvider(): BaseProvider | null {
    return this.providers[this._currentIndex] ?? this.providers[0] ?? null;
  }

  getStats(): ProviderStats[] {
    const now = Date.now();
    return this.providers.map((p, i) => {
      const h = p.getHealth();
      // `isAvailable` is only ever written as `true`, so it cannot be the source
      // of truth for status. A provider is really out when it is inside its
      // cooldown window, which is what `isReady` measures.
      const ready = p.isReady(now);
      const cooling = !ready && h.cooldownUntil > now;
      let status: ProviderStats['status'];
      if (!ready) status = 'error';
      else status = i === this._currentIndex ? 'active' : 'fallback';
      return {
        name: p.name,
        model: p.model,
        priority: this.priorities.get(p) ?? i,
        status,
        lastError: h.lastError,
        cooldownRemainingMs: cooling ? h.cooldownUntil - now : 0,
      };
    });
  }

  async chat(messages: unknown[], tools?: unknown[], options?: any): Promise<any> {
    let eligible = this.getEligibleProviders(options);
    if (eligible.length === 0) {
      this.providers.forEach((p) => p.resetCooldown());
      eligible = this.getEligibleProviders(options);
      if (eligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
    }
    return this.attemptWithFailover(eligible, messages, tools, options);
  }

  async *stream(messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any> {
    let eligible = this.getEligibleProviders(options);
    if (eligible.length === 0) {
      this.providers.forEach((p) => p.resetCooldown());
      eligible = this.getEligibleProviders(options);
      if (eligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
    }
    yield* this.attemptStreamWithFailover(eligible, messages, tools, options);
  }

  private async attemptWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): Promise<any> {
    const errors: Error[] = [];
    for (const provider of providers) {
      // Ctrl+C must stop the turn here, not after the whole chain has been
      // walked. Continuing used to burn every remaining provider and log a
      // misleading "Switching X -> Y (Request aborted)" for each one.
      if (options?.abortSignal?.aborted) throw abortError();
      try {
        logger.provider(`Using ${provider.name} (${provider.model})`);
        const result = await provider.chat(messages, tools, options);
        provider.recordSuccess();
        this._currentIndex = this.providers.indexOf(provider);
        return result;
      } catch (err: any) {
        if (isAbort(err, options?.abortSignal)) throw err;
        errors.push(err);
        this.handleProviderError(provider, err, providers);
      }
    }
    throw new AllProvidersExhaustedError(errors);
  }

  private async *attemptStreamWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any> {
    const errors: Error[] = [];
    for (const provider of providers) {
      if (options?.abortSignal?.aborted) throw abortError();
      let yielded = false;
      try {
        logger.provider(`Using ${provider.name} (${provider.model})`);
        const gen = provider.stream(messages, tools, options);
        for await (const chunk of gen) {
          yielded = true;
          yield chunk;
        }
        provider.recordSuccess();
        this._currentIndex = this.providers.indexOf(provider);
        return;
      } catch (err: any) {
        if (isAbort(err, options?.abortSignal)) throw err;
        errors.push(err);
        this.handleProviderError(provider, err, providers);
        // Chunks already reached the caller and cannot be un-sent. Falling over
        // here would splice a second provider's full answer onto the first
        // provider's partial one, so surface the failure instead.
        if (yielded) throw err;
      }
    }
    throw new AllProvidersExhaustedError(errors);
  }

  setActiveProvider(name: string): boolean {
    const lower = name.toLowerCase().trim();
    if (!lower) return false;

    // 1. Exact match on name, model, or name/model
    let idx = this.providers.findIndex((p) => {
      const pName = p.name.toLowerCase();
      const pModel = p.model.toLowerCase();
      return (
        pName === lower ||
        pModel === lower ||
        `${pName}/${pModel}`.toLowerCase() === lower
      );
    });

    // 2. Fuzzy / Substring match
    if (idx === -1) {
      idx = this.providers.findIndex((p) => {
        const pName = p.name.toLowerCase();
        const pModel = p.model.toLowerCase();
        return (
          pName.includes(lower) ||
          pModel.includes(lower) ||
          lower.includes(pName) ||
          lower.includes(pModel)
        );
      });
    }

    if (idx !== -1) {
      this._currentIndex = idx;
      this.providers[idx].resetCooldown();
      return true;
    }
    return false;
  }
}
