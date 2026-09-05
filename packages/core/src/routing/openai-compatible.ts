import OpenAI from 'openai';
import { BaseProvider } from './base-provider.js';
import { classifyError } from '../errors.js';

export class OpenAICompatibleProvider extends BaseProvider {
  private client: OpenAI;
  private _name: string;
  private _model: string;

  constructor(options: {
    name: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    baseUrl?: string;
    apiProvider?: string;
    timeout?: number;
    maxRetries?: number;
  }) {
    super();
    this._name = options.name;
    this._model = options.model;
    let url = options.baseURL || options.baseUrl;
    if (!url) {
      if (options.apiProvider === 'openrouter') {
        url = 'https://openrouter.ai/api/v1';
      } else if (options.apiProvider === 'nvidia_nim' || options.apiProvider === 'nvidia') {
        url = 'https://integrate.api.nvidia.com/v1';
      }
    }
    this.client = new OpenAI({
      apiKey: options.apiKey || 'dummy-key',
      baseURL: url,
      timeout: options.timeout ?? 45_000,
      maxRetries: options.maxRetries ?? 1,
    });
  }

  get name(): string {
    return this._name;
  }

  get model(): string {
    return this._model;
  }

  get canRead(): boolean {
    return true;
  }

  get canWrite(): boolean {
    return true;
  }

  private buildParams(messages: unknown[], tools: unknown[] = [], options: any = {}): any {
    const params: any = {
      model: this._model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 4096,
    };

    if (options.top_p !== undefined) params.top_p = options.top_p;
    if (options.seed !== undefined) params.seed = options.seed;
    if (options.reasoning_effort) params.reasoning_effort = options.reasoning_effort;
    if (options.chat_template_kwargs) params.chat_template_kwargs = options.chat_template_kwargs;
    if (options.extra_body) params.extra_body = options.extra_body;

    if (tools.length > 0) {
      params.tools = tools;
      params.tool_choice = options.tool_choice ?? 'auto';
    }

    return params;
  }

  async chat(messages: unknown[], tools: unknown[] = [], options: any = {}): Promise<any> {
    // When a stream callback is supplied, stream tokens live and assemble the
    // final response (text + tool calls + usage) — this is what the CLI uses.
    if (typeof options.onStream === 'function' || typeof options.onReasoning === 'function') {
      return this.chatStreaming(messages, tools, options);
    }
    try {
      const params = this.buildParams(messages, tools, options);
      const response = await this.client.chat.completions.create(params, { signal: options.abortSignal });
      this.recordSuccess();
      const choice = response.choices[0];
      const rawToolCalls = choice.message.tool_calls || [];
      return {
        content: choice.message.content || '',
        reasoning: (choice.message as any).reasoning_content || (choice.message as any).reasoning || '',
        toolCalls: rawToolCalls,
        usage: response.usage || {},
        finish_reason: choice.finish_reason,
      };
    } catch (err: any) {
      if (options.abortSignal?.aborted) throw new Error('Request aborted');
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }

  private async chatStreaming(messages: unknown[], tools: unknown[] = [], options: any = {}): Promise<any> {
    const params = this.buildParams(messages, tools, options);
    params.stream = true;
    params.stream_options = { include_usage: true };

    let content = '';
    let reasoning = '';
    let usage: any = {};
    let finish_reason: string | null = null;
    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      let stream: any;
      try {
        stream = await this.client.chat.completions.create(params, { signal: options.abortSignal });
      } catch (err: any) {
        // Some servers reject stream_options — retry without it once.
        if (/stream_options/i.test(err?.message ?? '')) {
          delete params.stream_options;
          stream = await this.client.chat.completions.create(params, { signal: options.abortSignal });
        } else throw err;
      }
      this.recordSuccess();

      for await (const chunk of stream as any) {
        if (options.abortSignal?.aborted) break;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        const r = delta.reasoning_content ?? delta.reasoning;
        if (r) {
          reasoning += r;
          options.onReasoning?.(r);
        }
        if (delta.content) {
          content += delta.content;
          options.onStream?.(delta.content);
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            let buf = toolCallBuffers.get(idx);
            if (!buf) {
              buf = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
              toolCallBuffers.set(idx, buf);
            }
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.arguments += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finish_reason = choice.finish_reason;
      }
    } catch (err: any) {
      if (options.abortSignal?.aborted) throw new Error('Request aborted');
      this.recordFailure();
      throw classifyError(err, this._name);
    }

    const toolCalls = Array.from(toolCallBuffers.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([i, b]) => ({ id: b.id || `call_${i}`, type: 'function', function: { name: b.name, arguments: b.arguments || '{}' } }))
      .filter(t => t.function.name);

    return { content, reasoning, toolCalls, usage, finish_reason };
  }

  async *stream(messages: unknown[], tools: unknown[] = [], options: any = {}): AsyncGenerator<any> {
    try {
      const params = this.buildParams(messages, tools, options);
      params.stream = true;

      const stream = await this.client.chat.completions.create(params);
      this.recordSuccess();

      const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();

      for await (const chunk of stream as any) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            let buf = toolCallBuffers.get(idx);
            if (!buf) {
              buf = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
              toolCallBuffers.set(idx, buf);
            }
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason) {
          for (const [, buf] of toolCallBuffers) {
            yield {
              type: 'tool_call',
              tool_call: {
                id: buf.id,
                type: 'function',
                function: { name: buf.name, arguments: buf.arguments },
              },
            };
          }
          toolCallBuffers.clear();

          yield {
            type: 'finish',
            finish_reason: choice.finish_reason,
            usage: chunk.usage || {},
          };
        }
      }
    } catch (err: any) {
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }
}
