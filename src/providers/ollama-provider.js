/**
 * Ollama Provider
 * Connects to a locally running Ollama instance for on-device LLM inference.
 */

import { Ollama } from 'ollama';
import { BaseProvider } from './base-provider.js';
import { classifyError, ProviderServerError } from '../utils/errors.js';

export class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);

    this.client = new Ollama({
      host: this.baseUrl || 'http://localhost:11434',
    });
  }

  /**
   * Non-streaming chat completion via Ollama.
   */
  async chat(messages, tools = [], options = {}) {
    try {
      // Check if Ollama is running first
      await this._ensureRunning();

      const params = {
        model: this.model,
        messages,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.max_tokens ?? 16384,
        },
      };

      // Add tools if the model supports them
      if (tools.length > 0 && this.supportsTools()) {
        params.tools = tools;
      }

      const response = await this.client.chat(params);
      this.recordSuccess();

      // Normalize Ollama response to match our standard format
      return {
        content: response.message.content || '',
        tool_calls: this._normalizeToolCalls(response.message.tool_calls || []),
        usage: {
          prompt_tokens: response.prompt_eval_count || 0,
          completion_tokens: response.eval_count || 0,
          total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
        },
        finish_reason: response.message.tool_calls?.length ? 'tool_calls' : 'stop',
      };
    } catch (err) {
      this.recordFailure(err);

      // Special case: Ollama not running
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        throw new ProviderServerError(this.name, 503);
      }

      throw classifyError(err, this.name);
    }
  }

  /**
   * Streaming chat completion via Ollama.
   */
  async *stream(messages, tools = [], options = {}) {
    try {
      await this._ensureRunning();

      const params = {
        model: this.model,
        messages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.max_tokens ?? 16384,
        },
      };

      if (tools.length > 0 && this.supportsTools()) {
        params.tools = tools;
      }

      const stream = await this.client.chat(params);

      for await (const chunk of stream) {
        // Text content
        if (chunk.message?.content) {
          yield { type: 'text', content: chunk.message.content };
        }

        // Tool calls (Ollama sends them in the final message)
        if (chunk.message?.tool_calls) {
          const normalized = this._normalizeToolCalls(chunk.message.tool_calls);
          for (const toolCall of normalized) {
            yield { type: 'tool_call', tool_call: toolCall };
          }
        }

        // Done signal
        if (chunk.done) {
          yield {
            type: 'finish',
            finish_reason: chunk.message?.tool_calls?.length ? 'tool_calls' : 'stop',
            usage: {
              prompt_tokens: chunk.prompt_eval_count || 0,
              completion_tokens: chunk.eval_count || 0,
            },
          };
        }
      }

      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);

      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        throw new ProviderServerError(this.name, 503);
      }

      throw classifyError(err, this.name);
    }
  }

  /**
   * Normalize Ollama's tool_calls format to match OpenAI's format.
   */
  _normalizeToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return [];

    return toolCalls.map((tc, idx) => ({
      id: `call_ollama_${idx}_${Date.now()}`,
      type: 'function',
      function: {
        name: tc.function?.name || '',
        arguments:
          typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {}),
      },
    }));
  }

  /**
   * Check if Ollama is running and accessible.
   */
  async _ensureRunning() {
    try {
      await this.client.list();
    } catch (err) {
      throw new Error(
        `Ollama is not running at ${this.baseUrl || 'http://localhost:11434'}. ` +
        'Start it with: ollama serve'
      );
    }
  }

  /**
   * Check if the configured model supports tool calling.
   * Llama 3.1+, Qwen 2.5+, and Mistral models support tools.
   */
  supportsTools() {
    const model = this.model.toLowerCase();
    const toolCapableModels = [
      'llama3.1', 'llama3.2', 'llama3.3', 'llama4',
      'qwen2.5', 'qwen3',
      'mistral', 'mixtral',
      'command-r', 'command-a',
      'firefunction',
      'granite3',
    ];

    return toolCapableModels.some((m) => model.includes(m));
  }

  /**
   * Health check — also verifies Ollama is running.
   */
  async healthCheck() {
    const start = Date.now();
    try {
      const models = await this.client.list();
      const hasModel = models.models?.some((m) =>
        m.name.includes(this.model.split(':')[0])
      );

      if (!hasModel) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Model "${this.model}" not found locally. Pull it with: ollama pull ${this.model}`,
        };
      }

      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Ollama is not running. Start it with: ollama serve`,
      };
    }
  }
}
