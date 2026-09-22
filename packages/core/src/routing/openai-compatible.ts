import OpenAI from 'openai';
import { BaseProvider } from './base-provider.js';
import { classifyError } from '../errors.js';

function fixToolArgsJson(args: string): string {
  if (!args || args.trim() === '' || args.trim() === '{}') return args;
  try {
    JSON.parse(args);
    return args;
  } catch {}

  // 1. Fix unescaped backslashes not valid JSON escapes: \d, \r etc
  let fixed = args.replace(/\\(?![\"\\/bfnrtu])/g, '\\\\');
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {}

  // 2. Slash conversion for Windows paths
  let slash = args.replace(/\\/g, '/');
  try {
    JSON.parse(slash);
    return slash;
  } catch {}

  let fixedSlash = fixed.replace(/\\/g, '/');
  try {
    JSON.parse(fixedSlash);
    return fixedSlash;
  } catch {}

  // 3. Robust extraction for write_file / read_file etc — handle literal newlines and unescaped quotes
  function extractStringValue(json: string, key: string): string | null {
    const keyPattern = `"${key}"`;
    const idx = json.indexOf(keyPattern);
    if (idx === -1) return null;
    let colonIdx = json.indexOf(':', idx + keyPattern.length);
    if (colonIdx === -1) return null;
    let start = colonIdx + 1;
    while (start < json.length && /\s/.test(json[start])) start++;
    if (json[start] !== '"') return null;
    start++;
    let result = '';
    let i = start;
    while (i < json.length) {
      const ch = json[i];
      if (ch === '\\') {
        if (i + 1 < json.length) {
          const next = json[i + 1];
          if (next === 'n') { result += '\n'; i += 2; continue; }
          if (next === 'r') { result += '\r'; i += 2; continue; }
          if (next === 't') { result += '\t'; i += 2; continue; }
          if (next === '"' || next === '\\' || next === '/') { result += next; i += 2; continue; }
          if (next === 'u') {
            // unicode escape \uXXXX
            const hex = json.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              result += String.fromCharCode(parseInt(hex, 16));
              i += 6;
              continue;
            }
          }
          // Unknown escape like \d — treat as literal \ + char
          result += '\\' + next;
          i += 2;
          continue;
        }
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < json.length && /\s/.test(json[j])) j++;
        if (j >= json.length || json[j] === ',' || json[j] === '}' || json[j] === ']') {
          break;
        }
        // Unescaped quote inside content — treat as literal
        result += ch;
        i++;
        continue;
      }
      result += ch;
      i++;
    }
    return result;
  }

  try {
    const pathVal = extractStringValue(args, 'path') || extractStringValue(fixed, 'path') || extractStringValue(slash, 'path');
    if (pathVal) {
      const fixedPath = pathVal.replace(/\\/g, '/');
      const contentVal = extractStringValue(args, 'content') || extractStringValue(fixed, 'content') || extractStringValue(slash, 'content');
      if (contentVal !== null) {
        return JSON.stringify({ path: fixedPath, content: contentVal });
      } else {
        // For other tools, try to reconstruct with path only and preserve other fields if possible
        // Try to extract common fields
        const result: any = { path: fixedPath };
        // Try to extract other simple string fields
        for (const key of ['old_string', 'new_string', 'pattern', 'query', 'url']) {
          const val = extractStringValue(args, key);
          if (val) result[key] = val;
        }
        // If we have at least path, return it; otherwise try full slash version
        if (Object.keys(result).length > 1 || contentVal === null) {
          // If content was null but we have path, return path only — better than failing
          // But try to include content if we can find it via alternative method
          return JSON.stringify(result);
        }
        return JSON.stringify({ path: fixedPath });
      }
    }
  } catch {}

  return fixedSlash || slash || args.replace(/\\/g, '/');
}

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

  get name(): string { return this._name; }
  get model(): string { return this._model; }
  get canRead(): boolean { return true; }
  get canWrite(): boolean { return true; }

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
    if (typeof options.onStream === 'function' || typeof options.onReasoning === 'function') {
      return this.chatStreaming(messages, tools, options);
    }
    try {
      const params = this.buildParams(messages, tools, options);
      const response = await this.client.chat.completions.create(params, { signal: options.abortSignal });
      this.recordSuccess();
      const choice = response.choices[0];
      const rawToolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
        ...tc,
        function: { ...tc.function, arguments: fixToolArgsJson(tc.function.arguments) },
      }));
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
      .map(([i, b]) => ({
        id: b.id || `call_${i}`,
        type: 'function',
        function: { name: b.name, arguments: fixToolArgsJson(b.arguments || '{}') },
      }))
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
        if (delta?.content) yield { type: 'text', content: delta.content };
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
              tool_call: { id: buf.id, type: 'function', function: { name: buf.name, arguments: fixToolArgsJson(buf.arguments) } },
            };
          }
          toolCallBuffers.clear();
          yield { type: 'finish', finish_reason: choice.finish_reason, usage: chunk.usage || {} };
        }
      }
    } catch (err: any) {
      this.recordFailure();
      throw classifyError(err, this._name);
    }
  }
}
