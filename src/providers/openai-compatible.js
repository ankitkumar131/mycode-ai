/**
 * OpenAI-Compatible Provider
 * Works with: OpenRouter, NVIDIA NIM, and any OpenAI-compatible endpoint.
 * Uses the official `openai` npm package with configurable baseURL.
 */

import OpenAI from 'openai';
import { BaseProvider } from './base-provider.js';
import { classifyError } from '../utils/errors.js';

export class OpenAICompatibleProvider extends BaseProvider {
  constructor(config) {
    super(config);

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: this._getDefaultHeaders(config),
      timeout: 120_000, // 2 minute timeout
    });
  }

  /**
   * Build provider-specific default headers.
   * OpenRouter requires specific headers for attribution.
   */
  _getDefaultHeaders(config) {
    const headers = {};

    if (config.api_provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/mycode-ai/mycode';
      headers['X-Title'] = 'MyCode AI';
    }

    return headers;
  }

  /**
   * Non-streaming chat completion.
   */
  async chat(messages, tools = [], options = {}) {
    try {
      const params = {
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 16384,
      };

      // Only add tools if we have some and the model should support them
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
    } catch (err) {
      this.recordFailure(err);
      throw classifyError(err, this.name);
    }
  }

  /**
   * Streaming chat completion.
   * Yields chunks: { type: 'text'|'tool_call', content?, tool_call? }
   */
  async *stream(messages, tools = [], options = {}) {
    try {
      const params = {
        model: this.model,
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

      // Accumulate tool calls as they arrive in chunks
      const toolCallAccumulator = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (!delta) continue;

        // Text content
        if (delta.content) {
          yield { type: 'text', content: delta.content };
        }

        // Tool calls arrive in streamed chunks — accumulate them
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].function.arguments += tc.function.arguments;

            // Emit progress delta so UI can show generation progress
            yield {
              type: 'tool_call_delta',
              name: toolCallAccumulator[idx].function.name,
              argumentsLength: toolCallAccumulator[idx].function.arguments.length,
            };
          }
        }

        // When finished, emit accumulated tool calls
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          const completedCalls = Object.values(toolCallAccumulator);
          if (completedCalls.length > 0) {
            for (const toolCall of completedCalls) {
              yield { type: 'tool_call', tool_call: toolCall };
            }
          }

          yield {
            type: 'finish',
            finish_reason: finishReason,
            usage: chunk.usage || null,
          };
        }
      }

      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
      throw classifyError(err, this.name);
    }
  }

  supportsTools() {
    return true;
  }
}
