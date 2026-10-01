import { BaseProvider } from './base-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import {
  RateLimitError,
  AuthError,
  ContextLengthError,
  ProviderServerError,
  AllProvidersExhaustedError,
  NoProvidersConfiguredError,
} from '../errors.js';
import { logger } from '../output/logger.js';
import type { ProviderConfig, ProviderStats } from './types.js';
import { describeFailoverReason } from './failover.js';

export class ProviderRouter {
  private providers: BaseProvider[] = [];
  private _currentIndex = 0;
  /** Index of the first provider that failed in this attempt, or -1. */
  private _attemptedProviderIndex = -1;
  /** Details of the most recent internal failover, consumed by the session. */
  private _lastFailover: { from: string; to: string; reason: string; at: number } | null = null;

  constructor(configs: ProviderConfig[] = []) {
    if (!configs.length) {
      throw new NoProvidersConfiguredError();
    }
    this.providers = configs
      .slice()
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((c) => this.createProvider(c));
  }

  private createProvider(config: ProviderConfig): BaseProvider {
    switch (config.apiProvider) {
      case 'ollama':
        return new OllamaProvider(config);
      case 'anthropic':
        // Native Messages API, not the OpenAI-compatible shim: this is what
        // keeps extended thinking, prompt caching and native tool schemas.
        return new AnthropicProvider(config);
      case 'openrouter':
      case 'nvidia_nim':
      case 'openai':
      case 'custom':
      default:
        return new OpenAICompatibleProvider(config);
    }
  }

  private getEligibleProviders(requirements: { needsWrite?: boolean; needsRead?: boolean } = {}): BaseProvider[] {
    // Reorder providers so the active provider (_currentIndex) is tried FIRST
    const activeIdx = Math.max(0, Math.min(this._currentIndex, this.providers.length - 1));
    const reordered = [
      ...this.providers.slice(activeIdx),
      ...this.providers.slice(0, activeIdx),
    ];

    return reordered.filter((p) => {
      const health = p.getHealth();
      if (!health.isAvailable) return false;
      if (requirements.needsWrite && !p.canWrite) return false;
      if (requirements.needsRead && !p.canRead) return false;
      return true;
    });
  }

  private handleProviderError(provider: BaseProvider, err: Error, remaining: BaseProvider[]): void {
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
    } else {
      logger.switchProviders(provider.name, nextLabel, err.message || 'unknown error');
    }
  }

  /**
   * Details of the most recent mid-call provider switch, if any.
   *
   * The session reads this to explain the switch to the user and to re-orient
   * the replacement model. The read is non-destructive so that the announcement
   * and the handoff brief both see the same event.
   */
  get lastFailover(): { from: string; to: string; reason: string; at: number } | null {
    return this._lastFailover;
  }

  getCurrentProvider(): BaseProvider | null {
    return this.providers[this._currentIndex] ?? this.providers[0] ?? null;
  }

  getStats(): ProviderStats[] {
    return this.providers.map((p) => {
      const h = p.getHealth();
      return {
        name: p.name,
        model: p.model,
        priority: 0,
        status: h.isAvailable ? 'active' : 'error',
      };
    });
  }

  async chat(messages: unknown[], tools?: unknown[], options?: any): Promise<any> {
    this._attemptedProviderIndex = -1;
    this._lastFailover = null;
    let eligible = this.getEligibleProviders(options);
    if (eligible.length === 0) {
      this.providers.forEach((p) => ((p as any)._health.isAvailable = true));
      eligible = this.getEligibleProviders(options);
      if (eligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
    }
    return this.attemptWithFailover(eligible, messages, tools, options);
  }

  async *stream(messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any> {
    this._attemptedProviderIndex = -1;
    this._lastFailover = null;
    let eligible = this.getEligibleProviders(options);
    if (eligible.length === 0) {
      this.providers.forEach((p) => ((p as any)._health.isAvailable = true));
      eligible = this.getEligibleProviders(options);
      if (eligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
    }
    yield* this.attemptStreamWithFailover(eligible, messages, tools, options);
  }

  /** Last provider we told the user about, so a stable session stays quiet. */
  private _announcedProvider: string | null = null;

  /**
   * Log which provider is serving us, but only when that changes.
   *
   * The agent loop issues one request per iteration, so announcing on every
   * request buried the transcript under identical lines. A switch (including a
   * failover) still announces, because that is information the user needs.
   */
  private announceOnce(provider: BaseProvider): void {
    const key = `${provider.name}\u0000${provider.model}`;
    if (this._announcedProvider === key) return;
    this._announcedProvider = key;
    logger.provider(`Using ${provider.name} (${provider.model})`);
  }

  /** Forget the announcement, e.g. after the user switches provider by hand. */
  resetAnnouncement(): void {
    this._announcedProvider = null;
  }

  private async attemptWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): Promise<any> {
    const errors: Error[] = [];
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        this.announceOnce(provider);
        const result = await provider.chat(messages, tools, options);
        const switchedFrom = providers[this._attemptedProviderIndex];
        if (this._attemptedProviderIndex >= 0 && switchedFrom && switchedFrom.name !== provider.name) {
          // Record *why* we moved on, so the session can hand the replacement
          // model an accurate account of what happened.
          this._lastFailover = {
            from: switchedFrom.name,
            to: provider.name,
            reason: describeFailoverReason(errors[errors.length - 1]),
            at: Date.now(),
          };
        }
        this._currentIndex = this.providers.indexOf(provider);
        return result;
      } catch (err: any) {
        errors.push(err);
        if (this._attemptedProviderIndex < 0) this._attemptedProviderIndex = i;
        this.handleProviderError(provider, err, providers);
      }
    }
    throw new AllProvidersExhaustedError(errors);
  }

  private async *attemptStreamWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any> {
    const errors: Error[] = [];
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        this.announceOnce(provider);
        const gen = provider.stream(messages, tools, options);
        for await (const chunk of gen) {
          yield chunk;
        }
        const switchedFrom = providers[this._attemptedProviderIndex];
        if (this._attemptedProviderIndex >= 0 && switchedFrom && switchedFrom.name !== provider.name) {
          this._lastFailover = {
            from: switchedFrom.name,
            to: provider.name,
            reason: describeFailoverReason(errors[errors.length - 1]),
            at: Date.now(),
          };
        }
        this._currentIndex = this.providers.indexOf(provider);
        return;
      } catch (err: any) {
        errors.push(err);
        if (this._attemptedProviderIndex < 0) this._attemptedProviderIndex = i;
        this.handleProviderError(provider, err, providers);
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
      (this.providers[idx] as any)._health.isAvailable = true;
      return true;
    }
    return false;
  }
}
