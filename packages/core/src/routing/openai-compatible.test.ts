import { RateLimitError, AuthError, ContextLengthError, ProviderServerError } from '../errors.js';

const mockCreate = vi.fn();

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

const { OpenAICompatibleProvider } = await import('./openai-compatible.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReset();
});

describe('OpenAICompatibleProvider', () => {
  it('exposes name and model', () => {
    const p = new OpenAICompatibleProvider({ name: 'test', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    expect(p.name).toBe('test');
    expect(p.model).toBe('gpt-4');
  });

  it('defaults canRead and canWrite to true', () => {
    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'm', apiKey: 'k' });
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
  });

  it('sets OpenRouter headers when apiProvider is openrouter', () => {
    const p = new OpenAICompatibleProvider({ name: 'or', apiProvider: 'openrouter', model: 'm', apiKey: 'k' });
    expect(p.name).toBe('or');
  });

  it('chat returns formatted response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello', tool_calls: [] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });

    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    const result = await p.chat([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('Hello');
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.finish_reason).toBe('stop');
    expect(p.getHealth().successCount).toBe(1);
  });

  it('chat passes tools to the API', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '', tool_calls: [{ id: 'tc1', function: { name: 'foo', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
      usage: {},
    });

    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    const tools = [{ type: 'function', function: { name: 'foo', parameters: { type: 'object' } } }];
    await p.chat([{ role: 'user', content: 'Do it' }], tools);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools,
      tool_choice: 'auto',
    }));
  });

  it('chat throws RateLimitError on 429', async () => {
    mockCreate.mockRejectedValueOnce({ status: 429, message: 'rate limit', headers: {} });
    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(RateLimitError);
    expect(p.getHealth().failureCount).toBe(1);
  });

  it('chat throws AuthError on 401', async () => {
    mockCreate.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });
    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'bad' });
    await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(AuthError);
  });

  it('chat throws ContextLengthError when context exceeded', async () => {
    mockCreate.mockRejectedValueOnce({ message: 'maximum context length exceeded' });
    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(ContextLengthError);
  });

  it('chat throws ProviderServerError on 5xx', async () => {
    mockCreate.mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' });
    const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
    await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(ProviderServerError);
  });

  describe('stream', () => {
    async function collectStream(provider: OpenAICompatibleProvider, messages: any[], tools?: any[]) {
      const events: any[] = [];
      for await (const ev of provider.stream(messages, tools)) {
        events.push(ev);
      }
      return events;
    }

    it('yields text chunks', async () => {
      async function* mockStream() {
        yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5 } };
      }
      mockCreate.mockResolvedValueOnce(mockStream());

      const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
      const events = await collectStream(p, [{ role: 'user', content: 'Hi' }]);

      expect(events.filter(e => e.type === 'text').map(e => e.content)).toEqual(['Hello', ' world']);
      expect(events.some(e => e.type === 'finish')).toBe(true);
    });

    it('yields tool call events', async () => {
      async function* mockStream() {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'foo', arguments: '{"a"' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      }
      mockCreate.mockResolvedValueOnce(mockStream());

      const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
      const events = await collectStream(p, [{ role: 'user', content: 'Use tool' }]);

      expect(events.filter(e => e.type === 'tool_call').length).toBe(1);
      expect(events.find(e => e.type === 'tool_call')!.tool_call.function.arguments).toBe('{"a":1}');
      expect(events.some(e => e.type === 'finish')).toBe(true);
    });

    it('handles streaming errors', async () => {
      mockCreate.mockRejectedValueOnce({ status: 429, message: 'rate limit', headers: {} });
      const p = new OpenAICompatibleProvider({ name: 't', apiProvider: 'openai', model: 'gpt-4', apiKey: 'sk-key' });
      await expect(collectStream(p, [{ role: 'user', content: 'Hi' }])).rejects.toThrow(RateLimitError);
    });
  });
});
