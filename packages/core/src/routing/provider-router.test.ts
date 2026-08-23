import { NoProvidersConfiguredError, AllProvidersExhaustedError, RateLimitError, AuthError } from '../errors.js';

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('openai', () => {
  const MockOpenAI = vi.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
  return { default: MockOpenAI };
});

// Prevent logger noise during tests
vi.mock('../output/logger.js', () => ({
  logger: {
    switchProviders: vi.fn(),
    provider: vi.fn(),
  },
}));

const { ProviderRouter } = await import('./provider-router.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReset();
  mockStream.mockReset();
});

describe('ProviderRouter', () => {
  it('throws NoProvidersConfiguredError for empty config', () => {
    expect(() => new ProviderRouter([])).toThrow(NoProvidersConfiguredError);
  });

  it('throws NoProvidersConfiguredError when no config provided', () => {
    expect(() => new ProviderRouter()).toThrow(NoProvidersConfiguredError);
  });

  it('creates a provider with default config', () => {
    const router = new ProviderRouter([
      { name: 'default', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
    ]);
    const current = router.getCurrentProvider();
    expect(current).not.toBeNull();
    expect(current!.name).toBe('default');
    expect(current!.model).toBe('gpt-4');
  });

  it('sorts providers by priority', () => {
    const router = new ProviderRouter([
      { name: 'low', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1', priority: 10 },
      { name: 'high', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k2', priority: 1 },
    ]);
    expect(router.getCurrentProvider()!.name).toBe('high');
  });

  it('defaults undefined priority to 99', () => {
    const router = new ProviderRouter([
      { name: 'a', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1' },
      { name: 'b', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k2', priority: 50 },
    ]);
    expect(router.getCurrentProvider()!.name).toBe('b');
  });

  it('getStats returns provider stats', () => {
    const router = new ProviderRouter([
      { name: 'p1', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1' },
    ]);
    const stats = router.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].name).toBe('p1');
    expect(stats[0].status).toBe('active');
  });

  it('routes to openai_compatible for unknown apiProvider', () => {
    const router = new ProviderRouter([
      { name: 'custom', apiProvider: 'custom', model: 'custom-model', apiKey: 'k1', baseUrl: 'http://localhost:8080' },
    ]);
    expect(router.getCurrentProvider()!.name).toBe('custom');
  });

  it('chat calls the provider and returns result', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello!', tool_calls: [] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const router = new ProviderRouter([
      { name: 'test', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
    ]);

    const result = await router.chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('Hello!');
  });

  it('failover to next provider on RateLimitError', async () => {
    mockCreate
      .mockRejectedValueOnce({ status: 429, message: 'rate limit', headers: {} })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'From backup', tool_calls: [] }, finish_reason: 'stop' }],
        usage: {},
      });

    const router = new ProviderRouter([
      { name: 'primary', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1', priority: 1 },
      { name: 'backup', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k2', priority: 2 },
    ]);

    const result = await router.chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('From backup');
  });

  it('failover exhausts all providers and throws', async () => {
    mockCreate
      .mockRejectedValueOnce({ status: 429, message: 'rate limit', headers: {} })
      .mockRejectedValueOnce({ status: 401, message: 'unauthorized' });

    const router = new ProviderRouter([
      { name: 'p1', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1', priority: 1 },
      { name: 'p2', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k2', priority: 2 },
    ]);

    await expect(router.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(AllProvidersExhaustedError);
  });

  it('setActiveProvider switches by name', () => {
    const router = new ProviderRouter([
      { name: 'primary', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1', priority: 1 },
      { name: 'backup', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k2', priority: 2 },
    ]);

    expect(router.setActiveProvider('backup')).toBe(true);
    expect(router.getCurrentProvider()!.name).toBe('backup');
  });

  it('setActiveProvider switches by model', () => {
    const router = new ProviderRouter([
      { name: 'p1', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1' },
      { name: 'p2', apiProvider: 'openai', model: 'claude-3', apiKey: 'k2' },
    ]);

    expect(router.setActiveProvider('claude-3')).toBe(true);
    expect(router.getCurrentProvider()!.name).toBe('p2');
  });

  it('setActiveProvider returns false for unknown name', () => {
    const router = new ProviderRouter([
      { name: 'p1', apiProvider: 'openai', model: 'gpt-4', apiKey: 'k1' },
    ]);

    expect(router.setActiveProvider('nonexistent')).toBe(false);
    expect(router.getCurrentProvider()!.name).toBe('p1');
  });
});
