import { truncateToolOutput } from '../tools/output-store.js';

const DEFAULT_MAX_TOKENS = 128_000;
const TOKEN_ESTIMATE_RATIO = 4;
const RESERVED_TOKENS = 4000;
/** Model-visible cap for a single tool result. Full text spills to disk. */
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_TOOL_ARG_CHARS = 4000;

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  name?: string;
  /**
   * Extended-thinking content, when the provider returned it.
   *
   * Kept on the message and sent back verbatim on the next request: the native
   * Anthropic API rejects a tool-use turn whose thinking blocks were dropped,
   * and losing them breaks the model's ability to build on its own prior
   * reasoning. OpenAI-compatible providers simply ignore the field.
   */
  thinking?: string;
  /** Provider signature for the thinking block; required on round-trip. */
  thinking_signature?: string;
}

export class ConversationContext {
  private messages: Message[] = [];
  private _maxTokens: number;

  constructor(maxTokens = DEFAULT_MAX_TOKENS) {
    this._maxTokens = maxTokens;
  }

  get maxTokens(): number {
    return this._maxTokens;
  }

  set maxTokens(v: number) {
    this._maxTokens = v;
  }

  addSystem(content: string): void {
    this.messages.push({ role: 'system', content });
  }

  /** Replace the primary (first) system message, or insert one. */
  setSystem(content: string): void {
    const idx = this.messages.findIndex(m => m.role === 'system');
    if (idx === -1) this.messages.unshift({ role: 'system', content });
    else this.messages[idx] = { role: 'system', content };
  }

  addMessage(msg: Message): void {
    this.messages.push(msg);
  }

  replaceMessages(msgs: Message[]): void {
    this.messages = [...msgs];
  }

  /** Estimated tokens per category (for /context). */
  breakdown(): { system: number; user: number; assistant: number; tool: number; total: number } {
    const out = { system: 0, user: 0, assistant: 0, tool: 0, total: 0 };
    for (const m of this.messages) {
      const t = this.countTokens(JSON.stringify(m));
      out[m.role] += t;
      out.total += t;
    }
    return out;
  }

  addUser(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistant(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  addAssistantWithTools(
    content: string,
    toolCalls: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>,
    thinking?: { text?: string; signature?: string }
  ): void {
    const sanitized = toolCalls.map(tc => {
      let argsStr = tc.function.arguments;
      if (argsStr.length > MAX_TOOL_ARG_CHARS) {
        try {
          const parsed = JSON.parse(argsStr);
          if (typeof parsed.content === 'string' && parsed.content.length > 1000) {
            parsed.content = parsed.content.slice(0, 500) + `\n... [${parsed.content.length - 1000} chars truncated for history efficiency] ...\n` + parsed.content.slice(-500);
            argsStr = JSON.stringify(parsed);
          }
        } catch {
          // If JSON parse fails, fallback to string slicing
          argsStr = argsStr.slice(0, MAX_TOOL_ARG_CHARS) + '...}';
        }
      }
      return {
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: argsStr,
        },
      };
    });

    this.messages.push({
      role: 'assistant',
      content,
      tool_calls: sanitized,
      ...(thinking?.text ? { thinking: thinking.text } : {}),
      ...(thinking?.signature ? { thinking_signature: thinking.signature } : {}),
    });
  }

  /**
   * Add a tool result, bounded by the output store.
   *
   * Unlike a plain slice, this keeps head *and* tail, records how much was
   * removed, and spills the full text to disk so the model can re-read it with
   * `read_file` instead of re-running an expensive command.
   */
  addToolResult(toolCallId: string, rawContent: string, name?: string): void {
    const result = truncateToolOutput(rawContent, {
      maxChars: MAX_TOOL_RESULT_CHARS,
      headChars: Math.floor(MAX_TOOL_RESULT_CHARS * 0.6),
      tailChars: Math.floor(MAX_TOOL_RESULT_CHARS * 0.3),
      label: name ?? 'tool',
    });

    this.messages.push({
      role: 'tool',
      content: result.text,
      tool_call_id: toolCallId,
      name,
    });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getLastMessage(): Message | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  getLastRole(): string | null {
    return this.getLastMessage()?.role ?? null;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
  }

  estimateTokens(): number {
    let total = 0;
    for (const msg of this.messages) {
      total += this.countTokens(JSON.stringify(msg));
    }
    return total;
  }

  trimToLimit(): number {
    while (this.estimateTokens() > this._maxTokens - RESERVED_TOKENS && this.messages.length > 2) {
      const systemMsg = this.messages[0].role === 'system' ? this.messages.shift() : null;
      this.messages.shift();
      this.messages.shift();
      if (systemMsg && this.messages[0]?.role !== 'system') {
        this.messages.unshift(systemMsg);
      }
    }
    return this.messages.length;
  }

  getHistory(limit?: number): Message[] {
    if (limit && this.messages.length > limit) {
      const systemMsgs = this.messages.filter(m => m.role === 'system');
      const rest = this.messages.filter(m => m.role !== 'system').slice(-(limit - systemMsgs.length));
      return [...systemMsgs, ...rest];
    }
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  toJSON(): string {
    return JSON.stringify(this.messages);
  }
}
