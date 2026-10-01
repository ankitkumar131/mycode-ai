import { describe, it, expect, afterEach, vi } from 'vitest';
import { AnthropicProvider } from './anthropic-provider.js';
import { RateLimitError, AuthError } from '../errors.js';

const provider = (over: Record<string, unknown> = {}) =>
  new AnthropicProvider({
    name: 'anthropic',
    apiProvider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: 'sk-ant-test',
    ...over,
  } as never);

/** Capture the JSON body of the single fetch call. */
function captureBody(): { body: Record<string, unknown> } {
  const captured = { body: {} as Record<string, unknown> };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured.body = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      } as unknown as Response;
    })
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe('AnthropicProvider request shape', () => {
  it('uses the native Messages API, not the OpenAI shim', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }),
        } as unknown as Response;
      })
    );
    await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(seen[0]).toContain('/v1/messages');
    expect(seen[0]).not.toContain('/chat/completions');
  });

  it('sends the required auth headers', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return { ok: true, json: async () => ({ content: [], usage: {} }) } as unknown as Response;
      })
    );
    await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('lifts system messages into the top-level system field', async () => {
    const cap = captureBody();
    await provider().chat([
      { role: 'system', content: 'You are MyCode.' },
      { role: 'user', content: 'hi' },
    ]);
    const system = cap.body.system as Array<{ text: string }>;
    expect(system[0].text).toBe('You are MyCode.');
    expect((cap.body.messages as unknown[]).length).toBe(1);
  });

  it('converts a tool result into a user message with a tool_result block', async () => {
    const cap = captureBody();
    await provider().chat([
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', content: 'file body', tool_call_id: 't1' },
    ]);
    const msgs = cap.body.messages as Array<{ role: string; content: unknown }>;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect((last.content as Array<{ type: string; tool_use_id: string }>)[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
    });
  });

  it('merges consecutive tool results into one user turn', async () => {
    // Anthropic rejects two `user` turns in a row; parallel tool calls produce
    // exactly that situation.
    const cap = captureBody();
    await provider().chat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          { id: 't2', type: 'function', function: { name: 'glob', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'one', tool_call_id: 't1' },
      { role: 'tool', content: 'two', tool_call_id: 't2' },
    ]);
    const msgs = cap.body.messages as Array<{ role: string; content: unknown[] }>;
    const userTurnsWithResults = msgs.filter(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
    );
    expect(userTurnsWithResults).toHaveLength(1);
    expect(userTurnsWithResults[0].content).toHaveLength(2);
  });

  it('preserves thinking blocks with their signature on the assistant turn', async () => {
    // This is the whole reason for a native adapter: drop the thinking block and
    // the model loses its own prior reasoning (and Anthropic rejects the turn).
    const cap = captureBody();
    await provider().chat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'working',
        thinking: 'Let me consider the tradeoffs.',
        thinking_signature: 'sig-abc',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      },
      { role: 'tool', content: 'ok', tool_call_id: 't1' },
    ]);
    const assistant = (cap.body.messages as Array<{ role: string; content: Array<Record<string, string>> }>).find(
      (m) => m.role === 'assistant'
    )!;
    expect(assistant.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Let me consider the tradeoffs.',
      signature: 'sig-abc',
    });
    // Thinking must precede text and tool_use.
    expect(assistant.content[1].type).toBe('text');
    expect(assistant.content[2].type).toBe('tool_use');
  });

  it('requests extended thinking for models that support it', async () => {
    const cap = captureBody();
    await provider({ model: 'claude-sonnet-4-5' }).chat([{ role: 'user', content: 'hi' }]);
    expect(cap.body.thinking).toMatchObject({ type: 'enabled' });
  });

  it('does not send temperature alongside thinking (Anthropic rejects it)', async () => {
    const cap = captureBody();
    await provider({ model: 'claude-sonnet-4-5' }).chat([{ role: 'user', content: 'hi' }], [], { temperature: 0.7 });
    expect(cap.body.thinking).toBeDefined();
    expect(cap.body.temperature).toBeUndefined();
  });

  it('sends native JSON Schema for tools', async () => {
    const cap = captureBody();
    await provider().chat([{ role: 'user', content: 'hi' }], [
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
    ]);
    const tools = cap.body.tools as Array<{ name: string; input_schema: { required: string[] } }>;
    expect(tools[0].name).toBe('write_file');
    expect(tools[0].input_schema.required).toEqual(['path', 'content']);
  });

  it('places cache breakpoints on tools, system, and the recent tail', async () => {
    // Prompt caching is what makes a 40-iteration agent loop affordable.
    const cap = captureBody();
    await provider().chat(
      [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hi' },
      ],
      [
        { type: 'function', function: { name: 'a', parameters: {} } },
        { type: 'function', function: { name: 'b', parameters: {} } },
      ]
    );
    const tools = cap.body.tools as Array<{ cache_control?: unknown }>;
    const system = cap.body.system as Array<{ cache_control?: unknown }>;
    expect(tools[tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[system.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('starts the conversation with a user turn even if history begins with assistant', async () => {
    const cap = captureBody();
    await provider().chat([
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: 'hello' },
    ]);
    const msgs = cap.body.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('user');
  });
});

describe('AnthropicProvider response parsing', () => {
  it('extracts text, thinking and tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'reasoning here', signature: 'sig-1' },
            { type: 'text', text: 'Here is the answer' },
            { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
          ],
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
          stop_reason: 'tool_use',
        }),
      })) as unknown as typeof fetch
    );

    const res = await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(res.content).toBe('Here is the answer');
    expect(res.reasoning).toBe('reasoning here');
    expect(res.thinkingSignature).toBe('sig-1');
    expect(res.toolCalls[0]).toMatchObject({
      id: 'tu_1',
      function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
    });
  });

  it('counts cache tokens toward the prompt total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
        }),
      })) as unknown as typeof fetch
    );
    const res = await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(res.usage.prompt_tokens).toBe(610);
    expect(res.usage.cache_read_input_tokens).toBe(500);
  });
});

describe('AnthropicProvider error classification', () => {
  it('maps 429 to RateLimitError so failover still works', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'rate limit reached' } }),
      })) as unknown as typeof fetch
    );
    await expect(provider().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(RateLimitError);
  });

  it('maps 401 to AuthError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'invalid x-api-key' } }),
      })) as unknown as typeof fetch
    );
    await expect(provider().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(AuthError);
  });

  it('surfaces the provider error message on an unexpected status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'thinking is not supported for this model' } }),
      })) as unknown as typeof fetch
    );
    await expect(provider().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/not supported/);
  });
});
