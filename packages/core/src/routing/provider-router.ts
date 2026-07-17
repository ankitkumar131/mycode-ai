import { BaseProvider } from './base-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama-provider.js';
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

export class ProviderRouter {
  private providers: BaseProvider[] = [];
  private _currentIndex = 0;

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
      case 'openrouter':
      case 'nvidia_nim':
      case 'openai':
      case 'custom':
      default:
        return new OpenAICompatibleProvider(config);
    }
  }

  private getEligibleProviders(requirements: { needsWrite?: boolean; needsRead?: boolean } = {}): BaseProvider[] {
    return this.providers.filter((p) => {
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

  private async attemptWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): Promise<any> {
    const errors: Error[] = [];
    for (const provider of providers) {
      try {
        logger.provider(`Using ${provider.name} (${provider.model})`);
        const result = await provider.chat(messages, tools, options);
        this._currentIndex = this.providers.indexOf(provider);
        return result;
      } catch (err: any) {
        errors.push(err);
        this.handleProviderError(provider, err, providers);
      }
    }
    throw new AllProvidersExhaustedError(errors);
  }

  private async *attemptStreamWithFailover(providers: BaseProvider[], messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any> {
    const errors: Error[] = [];
    for (const provider of providers) {
      try {
        logger.provider(`Using ${provider.name} (${provider.model})`);
        const gen = provider.stream(messages, tools, options);
        for await (const chunk of gen) {
          yield chunk;
        }
        this._currentIndex = this.providers.indexOf(provider);
        return;
      } catch (err: any) {
        errors.push(err);
        this.handleProviderError(provider, err, providers);
      }
    }
    throw new AllProvidersExhaustedError(errors);
  }

  setActiveProvider(name: string): boolean {
    const lower = name.toLowerCase();
    const idx = this.providers.findIndex(
      (p) =>
        p.name.toLowerCase() === lower ||
        p.model.toLowerCase() === lower ||
        `${p.name}/${p.model}`.toLowerCase() === lower
    );
    if (idx !== -1) {
      this._currentIndex = idx;
      (this.providers[idx] as any)._health.isAvailable = true;
      return true;
    }
    return false;
  }
}
