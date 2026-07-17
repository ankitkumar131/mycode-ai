const DEFAULT_MAX_TOKENS = 128_000;
const TOKEN_ESTIMATE_RATIO = 4;
const RESERVED_TOKENS = 4000;

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
    this.messages.push({ role: 'assistant', content, tool_calls: toolCalls });
  }

  addToolResult(toolCallId: string, content: string, name?: string): void {
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
