import OpenAI from 'openai';
import { BaseProvider } from './base-provider.js';
import { classifyError } from '../errors.js';
import type { ProviderConfig } from './types.js';

export class OpenAICompatibleProvider extends BaseProvider {
  private client: OpenAI;
  private _name: string;
  private _model: string;
  private _canRead: boolean;
  private _canWrite: boolean;

  constructor(config: ProviderConfig) {
    super();
    this._name = config.name;
    this._model = config.model;
    this._canRead = (config as any).read !== false;
    this._canWrite = (config as any).write !== false;

    this.client = new OpenAI({
      apiKey: config.apiKey || '',
      baseURL: config.baseUrl || undefined,
      defaultHeaders: this.buildHeaders(config),
      timeout: 120_000,
    });
  }

  private buildHeaders(config: ProviderConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    if (config.apiProvider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/mycode-ai/mycode';
      headers['X-Title'] = 'MyCode AI';
    }
    return headers;
  }

  get name(): string { return this._name; }
  get model(): string { return this._model; }
  get canRead(): boolean { return this._canRead; }
  get canWrite(): boolean { return this._canWrite; }

  async chat(messages: unknown[], tools: unknown[] = [], options: any = {}): Promise<any> {
    try {
      const params: any = {
        model: this._model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 16384,
      };
      if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = options.tool_choice ?? 'auto';
      }
      const response = await this.client.chat.completions.create(params);
      this.recordSuccess();
      const choice = response.choices[0];
      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls || [],
        usage: response.usage || {},
        finish_reason: choice.finish_reason,
      };
    } catch (err: any) {
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }

  async *stream(messages: unknown[], tools: unknown[] = [], options: any = {}): AsyncGenerator<any> {
    try {
      const params: any = {
        model: this._model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 16384,
        stream: true,
      };
      if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = options.tool_choice ?? 'auto';
      }
      const stream = await this.client.chat.completions.create(params);
      const toolCallAccumulator: Record<number, any> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].function.arguments += tc.function.arguments;
            yield { type: 'tool_call_delta', name: toolCallAccumulator[idx].function.name, argumentsLength: toolCallAccumulator[idx].function.arguments.length };
          }
        }

        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          const completedCalls = Object.values(toolCallAccumulator);
          for (const toolCall of completedCalls) {
            yield { type: 'tool_call', tool_call: toolCall };
          }
          yield { type: 'finish', finish_reason: finishReason, usage: chunk.usage || null };
        }
      }
      this.recordSuccess();
    } catch (err: any) {
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }
}
