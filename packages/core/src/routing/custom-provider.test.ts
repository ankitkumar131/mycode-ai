import { describe, it, expect, afterEach } from 'vitest';
import { ProviderRouter } from './provider-router.js';
import { BaseProvider } from './base-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderConfig } from './types.js';

/** Stand-in for a host-supplied provider implementation. */
class FakeProvider extends BaseProvider {
  calls = 0;
  constructor(
    private readonly cfg: ProviderConfig,
    private readonly label: string,
  ) {
    super();
  }
  get name(): string {
    return this.cfg.name;
  }
  get model(): string {
    return this.cfg.model;
  }
  get canRead(): boolean {
    return this.cfg.read !== false;
  }
  get canWrite(): boolean {
    return this.cfg.write !== false;
  }
  async chat(): Promise<{ content: string; toolCalls: unknown[] }> {
    this.calls++;
    this.recordSuccess();
    return { content: this.label, toolCalls: [] };
  }
  async *stream(): AsyncGenerator<{ content: string }> {
    yield { content: this.label };
  }
}

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'acme',
  apiProvider: 'acme-llm',
  model: 'acme-large',
  priority: 1,
  ...over,
});

afterEach(() => {
  ProviderRouter.unregisterProviderFactory('acme-llm');
  ProviderRouter.unregisterProviderFactory('openai');
});

describe('ProviderRouter custom provider factories', () => {
  it('uses a registered factory for its apiProvider id', async () => {
    let built = 0;
    ProviderRouter.registerProviderFactory('acme-llm', (cfg) => {
      built++;
      return new FakeProvider(cfg, 'from-acme');
    });

    const router = new ProviderRouter([config()]);
    expect(built).toBe(1);
    expect(router.getCurrentProvider()?.name).toBe('acme');
    await expect(router.chat([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      content: 'from-acme',
    });
  });

  it('lets a factory override a built-in id', async () => {
    ProviderRouter.registerProviderFactory('openai', (cfg) => new FakeProvider(cfg, 'overridden'));
    const router = new ProviderRouter([config({ apiProvider: 'openai', name: 'patched' })]);
    await expect(router.chat([])).resolves.toMatchObject({ content: 'overridden' });
  });

  it('falls back to the built-in provider once the factory is removed', () => {
    ProviderRouter.registerProviderFactory('openai', (cfg) => new FakeProvider(cfg, 'temp'));
    expect(
      new ProviderRouter([config({ apiProvider: 'openai' })]).getCurrentProvider(),
    ).not.toBeInstanceOf(OpenAICompatibleProvider);

    ProviderRouter.unregisterProviderFactory('openai');
    const router = new ProviderRouter([
      config({ apiProvider: 'openai', apiKey: 'sk-test', baseUrl: 'http://127.0.0.1:1/v1' }),
    ]);
    expect(router.getCurrentProvider()).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('lists registered ids and reports removal', () => {
    ProviderRouter.registerProviderFactory('acme-llm', (cfg) => new FakeProvider(cfg, 'x'));
    expect(ProviderRouter.providerFactoryIds()).toContain('acme-llm');
    expect(ProviderRouter.unregisterProviderFactory('acme-llm')).toBe(true);
    expect(ProviderRouter.unregisterProviderFactory('acme-llm')).toBe(false);
    expect(ProviderRouter.providerFactoryIds()).not.toContain('acme-llm');
  });

  it('keeps provider order and permission filtering intact', () => {
    ProviderRouter.registerProviderFactory('acme-llm', (cfg) => new FakeProvider(cfg, cfg.name));
    const router = new ProviderRouter([
      config({ name: 'second', priority: 2 }),
      config({ name: 'first', priority: 1 }),
    ]);
    expect(router.getStats().map((s) => s.name)).toEqual(['first', 'second']);
  });
});
