const DEFAULT_MAX_TOKENS = 128_000;
const TOKEN_ESTIMATE_RATIO = 4;
const RESERVED_TOKENS = 4000;
const MAX_TOOL_RESULT_CHARS = 8000;
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
}

export class ConversationContext {
  private messages: Message[] = [];
  private maxTokens: number;

  constructor(maxTokens = DEFAULT_MAX_TOKENS) {
    this.maxTokens = maxTokens;
  }

  addSystem(content: string): void {
    this.messages.push({ role: 'system', content });
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
    }>
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

    this.messages.push({ role: 'assistant', content, tool_calls: sanitized });
  }

  addToolResult(toolCallId: string, rawContent: string, name?: string): void {
    let content = rawContent;
    if (content.length > MAX_TOOL_RESULT_CHARS) {
      const head = content.slice(0, 3000);
      const tail = content.slice(-3000);
      content = `${head}\n... [${content.length - 6000} characters truncated for context speed & efficiency] ...\n${tail}`;
    }

    this.messages.push({
      role: 'tool',
      content,
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
    while (this.estimateTokens() > this.maxTokens - RESERVED_TOKENS && this.messages.length > 2) {
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
