import { Ollama } from 'ollama';
import { BaseProvider } from './base-provider.js';
import { classifyError, ProviderServerError } from '../errors.js';
import type { ProviderConfig } from './types.js';

const TOOL_CAPABLE_MODELS = [
  'llama3.1', 'llama3.2', 'llama3.3', 'llama4',
  'qwen2.5', 'qwen3',
  'mistral', 'mixtral',
  'command-r', 'command-a',
  'firefunction',
  'granite3',
];

export class OllamaProvider extends BaseProvider {
  private client: Ollama;
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

    this.client = new Ollama({
      host: config.baseUrl || 'http://localhost:11434',
    });
  }

  get name(): string { return this._name; }
  get model(): string { return this._model; }
  get canRead(): boolean { return this._canRead; }
  get canWrite(): boolean { return this._canWrite; }

  private async ensureRunning(): Promise<void> {
    try {
      await this.client.list();
    } catch {
      throw new Error(
        `Ollama is not running at ${(this.client as any).host || 'http://localhost:11434'}. ` +
        'Start it with: ollama serve'
      );
    }
  }

  private normalizeToolCalls(toolCalls: any[]): any[] {
    if (!toolCalls || toolCalls.length === 0) return [];
    return toolCalls.map((tc: any, idx: number) => ({
      id: `call_ollama_${idx}_${Date.now()}`,
      type: 'function',
      function: {
        name: tc.function?.name || '',
        arguments: typeof tc.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments || {}),
      },
    }));
  }

  async chat(messages: unknown[], tools: unknown[] = [], options: any = {}): Promise<any> {
    try {
      await this.ensureRunning();
      const params: any = {
        model: this._model,
        messages,
        options: { temperature: options.temperature ?? 0.3, num_predict: options.max_tokens ?? 16384 },
      };
      if (tools.length > 0 && this.supportsTools()) {
        params.tools = tools;
      }
      const response: any = await this.client.chat(params);
      this.recordSuccess();
      return {
        content: response.message?.content || '',
        tool_calls: this.normalizeToolCalls(response.message?.tool_calls || []),
        usage: {
          prompt_tokens: response.prompt_eval_count || 0,
          completion_tokens: response.eval_count || 0,
          total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
        },
        finish_reason: response.message?.tool_calls?.length ? 'tool_calls' : 'stop',
      };
    } catch (err: any) {
      this.recordFailure();
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        throw new ProviderServerError(this._name, 503);
      }
      throw classifyError(err, this._name);
    }
  }

  async *stream(messages: unknown[], tools: unknown[] = [], options: any = {}): AsyncGenerator<any> {
    try {
      await this.ensureRunning();
      const params: any = {
        model: this._model,
        messages,
        stream: true,
        options: { temperature: options.temperature ?? 0.3, num_predict: options.max_tokens ?? 16384 },
      };
      if (tools.length > 0 && this.supportsTools()) {
        params.tools = tools;
      }
      const stream: any = await this.client.chat(params);

      for await (const chunk of stream) {
        if (chunk.message?.content) {
          yield { type: 'text', content: chunk.message.content };
        }
        if (chunk.message?.tool_calls) {
          const normalized = this.normalizeToolCalls(chunk.message.tool_calls);
          for (const toolCall of normalized) {
            yield { type: 'tool_call', tool_call: toolCall };
          }
        }
        if (chunk.done) {
          yield {
            type: 'finish',
            finish_reason: chunk.message?.tool_calls?.length ? 'tool_calls' : 'stop',
            usage: { prompt_tokens: chunk.prompt_eval_count || 0, completion_tokens: chunk.eval_count || 0 },
          };
        }
      }
      this.recordSuccess();
    } catch (err: any) {
      this.recordFailure();
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        throw new ProviderServerError(this._name, 503);
      }
      throw classifyError(err, this._name);
    }
  }

  supportsTools(): boolean {
    const model = this._model.toLowerCase();
    return TOOL_CAPABLE_MODELS.some((m) => model.includes(m));
  }
}
