/**
 * Anthropic Messages API provider — native, not OpenAI-compatible.
 *
 * Anthropic offers an OpenAI-compatible endpoint, and that is what every
 * "supports Claude" client uses. It is also where most of Claude's coding
 * ability is quietly thrown away:
 *
 *   1. EXTENDED THINKING. The OpenAI shim strips thinking blocks, so the model
 *      cannot build on its own prior reasoning across turns. With native
 *      `thinking` enabled and blocks round-tripped back verbatim, multi-step
 *      work improves noticeably — this is the single highest-value protocol
 *      difference for an agent loop.
 *
 *   2. PROMPT CACHING. `cache_control: { type: 'ephemeral' }` marks the system
 *      prompt, the tool definitions, and a moving window of recent turns. Those
 *      are exactly the parts of an agent request that repeat every iteration,
 *      so cache hits cut both cost and latency substantially. Without
 *      breakpoints every iteration re-reads the whole prefix at full price.
 *
 *   3. NATIVE TOOL SCHEMAS. `input_schema` accepts real JSON Schema; the shim
 *      flattens parameters and loses `required`, enums and nested objects, which
 *      is what makes models emit malformed arguments.
 *
 * Failure classification reuses `classifyError` so priority failover behaves
 * identically to every other provider.
 */

import { BaseProvider } from './base-provider.js';
import { classifyError } from '../errors.js';
import type { ProviderConfig } from './types.js';

const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8_192;
/**
 * Thinking budget. Anthropic requires `max_tokens > budget_tokens`; 4k of
 * reasoning is enough for planning-heavy agent turns without starving output.
 */
const DEFAULT_THINKING_BUDGET = 4_096;
const REQUEST_TIMEOUT_MS = 600_000;

/** Number of recent turns kept in the cache window. */
const CACHE_TAIL_TURNS = 4;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export class AnthropicProvider extends BaseProvider {
  private config: ProviderConfig;
  private _name: string;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this._name = config.name || 'anthropic';
  }

  get name(): string {
    return this._name;
  }
  get model(): string {
    return this.config.model;
  }
  get canRead(): boolean {
    return this.config.read !== false;
  }
  get canWrite(): boolean {
    return this.config.write !== false;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': API_VERSION,
      // Enables the browser-style direct call to work in restricted environments
      // and is harmless otherwise.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  /**
   * Convert the conversation to Anthropic's shape.
   *
   * Two things need care:
   *   - Anthropic has no `tool` role. Tool results must be `user` messages
   *     containing `tool_result` blocks, and an assistant turn's `tool_use`
   *     blocks must be preserved alongside its text.
   *   - `thinking` blocks must be echoed back exactly as received (with their
   *     signature) when extended thinking is on, or the request is rejected.
   */
  private toAnthropic(messages: unknown[]): {
    system: AnthropicContentBlock[];
    messages: AnthropicMessage[];
  } {
    const system: AnthropicContentBlock[] = [];
    const out: AnthropicMessage[] = [];

    for (const raw of messages) {
      const m = raw as {
        role: string;
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        tool_call_id?: string;
        name?: string;
        thinking?: string;
        thinking_signature?: string;
      };

      if (m.role === 'system') {
        if (m.content) system.push({ type: 'text', text: m.content });
        continue;
      }

      if (m.role === 'tool') {
        const block: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: m.content ?? '',
        };
        // Consecutive tool results collapse into one user turn; Anthropic
        // requires alternating roles and rejects two user turns in a row.
        const last = out[out.length - 1];
        if (
          last &&
          last.role === 'user' &&
          Array.isArray(last.content) &&
          last.content[0]?.type === 'tool_result'
        ) {
          last.content.push(block);
        } else {
          out.push({ role: 'user', content: [block] });
        }
        continue;
      }

      if (m.role === 'assistant') {
        const blocks: AnthropicContentBlock[] = [];
        // Thinking must come first, exactly as produced.
        if (m.thinking) {
          blocks.push({ type: 'thinking', thinking: m.thinking, signature: m.thinking_signature });
        }
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls ?? []) {
          let input: unknown = {};
          try {
            input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
        if (!blocks.length) continue;
        out.push({ role: 'assistant', content: blocks });
        continue;
      }

      out.push({ role: 'user', content: m.content ?? '' });
    }

    // Anthropic requires the first message to be `user`.
    while (out.length && out[0].role !== 'user') out.shift();
    if (!out.length) out.push({ role: 'user', content: '' });

    return { system, messages: out };
  }

  private toTools(tools: unknown[]): unknown[] {
    return (
      tools as Array<{ function?: { name: string; description?: string; parameters?: unknown } }>
    )
      .filter((t) => t?.function?.name)
      .map((t) => ({
        name: t.function!.name,
        description: t.function!.description ?? '',
        input_schema: t.function!.parameters ?? { type: 'object', properties: {} },
      }));
  }

  /**
   * Place cache breakpoints.
   *
   * Anthropic caches the longest matching *prefix*, so the breakpoints go on the
   * parts that never change (tools, then system) and on the tail of the
   * conversation so the next turn can reuse this turn's prefix.
   */
  private withCacheBreakpoints(
    system: AnthropicContentBlock[],
    messages: AnthropicMessage[],
    tools: unknown[],
  ): void {
    if (tools.length) {
      const lastTool = tools[tools.length - 1] as { cache_control?: unknown };
      lastTool.cache_control = { type: 'ephemeral' };
    }
    if (system.length) {
      system[system.length - 1].cache_control = { type: 'ephemeral' };
    }
    // Mark the last few turns so incremental growth stays cacheable.
    let marked = 0;
    for (let i = messages.length - 1; i >= 0 && marked < CACHE_TAIL_TURNS; i--) {
      const content = messages[i].content;
      if (Array.isArray(content) && content.length) {
        content[content.length - 1].cache_control = { type: 'ephemeral' };
        marked++;
      }
    }
  }

  private buildBody(
    messages: unknown[],
    tools: unknown[],
    options: any,
    stream: boolean,
  ): Record<string, unknown> {
    const { system, messages: anthMessages } = this.toAnthropic(messages);
    const anthTools = this.toTools(tools ?? []);

    const maxTokens: number = options.max_tokens ?? DEFAULT_MAX_TOKENS;

    // Extended thinking is opt-in per request, and incompatible with
    // temperature/top_p overrides — Anthropic rejects the combination.
    const thinkingEnabled =
      options.thinking !== false && /claude-(3-7|4|opus-4|sonnet-4|haiku-4)/.test(this.model);
    const thinkingBudget = Math.min(
      options.thinking_budget ?? DEFAULT_THINKING_BUDGET,
      Math.max(1_024, maxTokens - 1_024),
    );

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: anthMessages,
      stream,
    };
    if (system.length) body.system = system;
    if (anthTools.length) body.tools = anthTools;

    if (thinkingEnabled) {
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    } else {
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.top_p !== undefined) body.top_p = options.top_p;
    }

    this.withCacheBreakpoints(system, anthMessages, anthTools);

    return body;
  }

  private parseResponse(data: any): {
    content: string;
    reasoning: string;
    thinkingSignature?: string;
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    usage: unknown;
    finish_reason?: string;
  } {
    const blocks: AnthropicContentBlock[] = data?.content ?? [];
    let content = '';
    let reasoning = '';
    let thinkingSignature: string | undefined;
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];

    for (const b of blocks) {
      if (b.type === 'text') content += b.text ?? '';
      else if (b.type === 'thinking') {
        reasoning += b.thinking ?? '';
        thinkingSignature = b.signature ?? thinkingSignature;
      } else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id ?? `call_${toolCalls.length}`,
          type: 'function',
          function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }

    const usage = data?.usage
      ? {
          prompt_tokens:
            (data.usage.input_tokens ?? 0) +
            (data.usage.cache_read_input_tokens ?? 0) +
            (data.usage.cache_creation_input_tokens ?? 0),
          completion_tokens: data.usage.output_tokens ?? 0,
          cache_read_input_tokens: data.usage.cache_read_input_tokens,
          cache_creation_input_tokens: data.usage.cache_creation_input_tokens,
        }
      : {};

    return {
      content,
      reasoning,
      thinkingSignature,
      toolCalls,
      usage,
      finish_reason: data?.stop_reason,
    };
  }

  async chat(messages: unknown[], tools: unknown[] = [], options: any = {}): Promise<any> {
    if (typeof options.onStream === 'function' || typeof options.onReasoning === 'function') {
      return this.chatStreaming(messages, tools, options);
    }

    try {
      const body = this.buildBody(messages, tools, options, false);
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/messages`,
        body,
        options.abortSignal,
      );
      if (!res.ok) throw await this.errorFrom(res);
      const data = await res.json();
      this.recordSuccess();
      return this.parseResponse(data);
    } catch (err: any) {
      if (options.abortSignal?.aborted) throw new Error('Request aborted');
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }

  private async chatStreaming(messages: unknown[], tools: unknown[], options: any): Promise<any> {
    try {
      const body = this.buildBody(messages, tools, options, true);
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/messages`,
        body,
        options.abortSignal,
      );
      if (!res.ok) throw await this.errorFrom(res);

      if (!res.body) throw new Error('Anthropic stream had no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let content = '';
      let reasoning = '';
      let thinkingSignature: string | undefined;
      let usage: any = {};
      let finish_reason: string | undefined;
      const toolBuffers = new Map<number, { id: string; name: string; json: string }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let ev: any;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }

          switch (ev.type) {
            case 'content_block_start':
              if (ev.content_block?.type === 'tool_use') {
                toolBuffers.set(ev.index, {
                  id: ev.content_block.id,
                  name: ev.content_block.name,
                  json: '',
                });
              } else if (ev.content_block?.type === 'thinking') {
                thinkingSignature = ev.content_block.signature ?? thinkingSignature;
              }
              break;
            case 'content_block_delta': {
              const d = ev.delta ?? {};
              if (d.type === 'text_delta' && d.text) {
                content += d.text;
                options.onStream?.(d.text);
              } else if (d.type === 'thinking_delta' && d.thinking) {
                reasoning += d.thinking;
                options.onReasoning?.(d.thinking);
              } else if (d.type === 'signature_delta' && d.signature) {
                thinkingSignature = d.signature;
              } else if (d.type === 'input_json_delta') {
                const buf = toolBuffers.get(ev.index);
                if (buf) buf.json += d.partial_json ?? '';
              }
              break;
            }
            case 'message_delta':
              if (ev.delta?.stop_reason) finish_reason = ev.delta.stop_reason;
              if (ev.usage) usage = { ...usage, ...ev.usage };
              break;
            case 'message_start':
              if (ev.message?.usage) usage = { ...usage, ...ev.message.usage };
              break;
            default:
              break;
          }
        }
      }

      const toolCalls = Array.from(toolBuffers.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, b]) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: b.json || '{}' },
        }))
        .filter((t) => t.function.name);

      this.recordSuccess();

      return {
        content,
        reasoning,
        thinkingSignature,
        toolCalls,
        usage: {
          prompt_tokens:
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          completion_tokens: usage.output_tokens ?? 0,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
        },
        finish_reason,
      };
    } catch (err: any) {
      if (options.abortSignal?.aborted) throw new Error('Request aborted');
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }

  /** Anthropic has no /chat/completions; streaming shares the same endpoint. */
  async *stream(
    messages: unknown[],
    tools: unknown[] = [],
    options: any = {},
  ): AsyncGenerator<any> {
    const result = await this.chatStreaming(messages, tools, {
      ...options,
      onStream: undefined,
      onReasoning: undefined,
    });
    if (result.reasoning) yield { type: 'reasoning', text: result.reasoning };
    if (result.content) yield { type: 'text', text: result.content };
    for (const tc of result.toolCalls) yield { type: 'tool_call', toolCall: tc };
    yield { type: 'finish', usage: result.usage, finish_reason: result.finish_reason };
  }

  private async fetchWithTimeout(
    url: string,
    body: unknown,
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => controller.abort();
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
    }
  }

  private async errorFrom(res: Response): Promise<Error> {
    let detail = '';
    try {
      const data = (await res.json()) as { error?: { message?: string; type?: string } };
      detail = data?.error?.message ?? JSON.stringify(data).slice(0, 300);
    } catch {
      detail = await res.text().catch(() => '');
    }
    const err = new Error(`Anthropic (${this.model}) HTTP ${res.status}: ${detail}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    err.name = 'ProviderError';
    return err;
  }

  toJSON() {
    return {
      name: this.name,
      model: this.model,
      priority: this.config.priority ?? 0,
      status: this.getHealth().isAvailable ? ('active' as const) : ('error' as const),
    };
  }
}
