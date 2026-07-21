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
    apiProvider?: string;
  }) {
    super();
    this._name = options.name;
    this._model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey || 'dummy-key',
      baseURL: options.baseURL,
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
      const rawToolCalls = choice.message.tool_calls || [];
      return {
        content: choice.message.content || '',
        toolCalls: rawToolCalls,
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
