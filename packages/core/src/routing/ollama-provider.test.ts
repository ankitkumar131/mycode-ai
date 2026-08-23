import { ProviderServerError } from '../errors.js';

const mockList = vi.fn();
const mockChatFn = vi.fn();

vi.mock('ollama', () => {
  const MockOllama = vi.fn(() => ({
    list: mockList,
    chat: mockChatFn,
  }));
  return { Ollama: MockOllama };
});

const { OllamaProvider } = await import('./ollama-provider.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockReset();
  mockChatFn.mockReset();
  mockList.mockResolvedValue({ models: [] });
});

describe('OllamaProvider', () => {
  it('exposes name and model', () => {
    const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
    expect(p.name).toBe('local');
    expect(p.model).toBe('llama3.2');
  });

  it('defaults canRead and canWrite to true', () => {
    const p = new OllamaProvider({ name: 't', apiProvider: 'ollama', model: 'm' });
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
  });

  describe('chat', () => {
    it('returns formatted response', async () => {
      mockChatFn.mockResolvedValueOnce({
        message: { content: 'Hello from Ollama', tool_calls: [] },
        prompt_eval_count: 10,
        eval_count: 20,
      });

      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      const result = await p.chat([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('Hello from Ollama');
      expect(result.tool_calls).toEqual([]);
      expect(result.usage.total_tokens).toBe(30);
      expect(result.finish_reason).toBe('stop');
      expect(p.getHealth().successCount).toBe(1);
    });

    it('passes tools for supported models', async () => {
      mockChatFn.mockResolvedValueOnce({
        message: { content: '', tool_calls: [{ function: { name: 'foo', arguments: '{}' } }] },
      });

      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      const tools = [{ type: 'function', function: { name: 'foo' } }];
      await p.chat([{ role: 'user', content: 'Use tool' }], tools);

      expect(mockChatFn).toHaveBeenCalledWith(expect.objectContaining({ tools }));
    });

    it('normalizes tool call arguments to strings', async () => {
      mockChatFn.mockResolvedValueOnce({
        message: { content: '', tool_calls: [{ function: { name: 'foo', arguments: { key: 'value' } } }] },
      });

      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      const result = await p.chat([{ role: 'user', content: 'Use tool' }], [{}]);

      expect(result.tool_calls[0].function.arguments).toBe('{"key":"value"}');
      expect(result.finish_reason).toBe('tool_calls');
    });

    it('throws ProviderServerError on ECONNREFUSED', async () => {
      mockChatFn.mockRejectedValueOnce({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(ProviderServerError);
    });

    it('throws error when Ollama is not running', async () => {
      mockList.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      await expect(p.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/Ollama is not running/);
    });
  });

  describe('stream', () => {
    async function collectStream(provider: OllamaProvider, messages: any[], tools?: any[]) {
      const events: any[] = [];
      for await (const ev of provider.stream(messages, tools)) {
        events.push(ev);
      }
      return events;
    }

    it('yields text chunks and finish event', async () => {
      async function* mockStreamFn() {
        yield { message: { content: 'Hello' }, done: false };
        yield { message: { content: ' world' }, done: false };
        yield { message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 10 };
      }
      mockChatFn.mockResolvedValueOnce(mockStreamFn());

      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      const events = await collectStream(p, [{ role: 'user', content: 'Hi' }]);

      expect(events.filter(e => e.type === 'text').map(e => e.content)).toEqual(['Hello', ' world']);
      expect(events.some(e => e.type === 'finish')).toBe(true);
    });

    it('yields tool call events', async () => {
      async function* mockStreamFn() {
        yield { message: { content: '', tool_calls: [{ function: { name: 'foo', arguments: '{}' } }] }, done: false };
        yield { message: { content: '' }, done: true, prompt_eval_count: 5 };
      }
      mockChatFn.mockResolvedValueOnce(mockStreamFn());

      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      const events = await collectStream(p, [{ role: 'user', content: 'Use tool' }], [{}]);

      expect(events.filter(e => e.type === 'tool_call').length).toBe(1);
      expect(events.find(e => e.type === 'tool_call')!.tool_call.function.name).toBe('foo');
    });

    it('handles streaming errors', async () => {
      mockChatFn.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
      const p = new OllamaProvider({ name: 'local', apiProvider: 'ollama', model: 'llama3.2' });
      await expect(collectStream(p, [{ role: 'user', content: 'Hi' }])).rejects.toThrow();
    });
  });

  describe('supportsTools', () => {
    it('returns true for known tool-capable models', () => {
      const p = new OllamaProvider({ name: 't', apiProvider: 'ollama', model: 'llama3.2' });
      expect(p.supportsTools()).toBe(true);
    });

    it('returns true for mistral models', () => {
      const p = new OllamaProvider({ name: 't', apiProvider: 'ollama', model: 'mistral:v3' });
      expect(p.supportsTools()).toBe(true);
    });

    it('returns false for unknown models', () => {
      const p = new OllamaProvider({ name: 't', apiProvider: 'ollama', model: 'tinyllama' });
      expect(p.supportsTools()).toBe(false);
    });
  });
});
