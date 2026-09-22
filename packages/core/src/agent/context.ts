// Claude Code style: token efficient, aggressive truncation, smart history
// FIX: Removed aggressive file read dedup that caused model to retry and waste tokens
const DEFAULT_MAX_TOKENS = 128_000;
const TOKEN_ESTIMATE_RATIO = 4;
const RESERVED_TOKENS = 6000;
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_TOOL_ARG_CHARS = 2000;
const MAX_TOOL_RESULT_LINES = 100;

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
  private _maxTokens: number;
  private _recentUserHashes = new Map<string, number>(); // Prevent duplicate prompts
  private _lastUserContent = '';

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

  breakdown(): { system: number; user: number; assistant: number; tool: number; total: number } {
    const out = { system: 0, user: 0, assistant: 0, tool: 0, total: 0 };
    for (const m of this.messages) {
      const t = this.countTokens(JSON.stringify(m));
      out[m.role] += t;
      out.total += t;
    }
    return out;
  }

  addUser(content: string): boolean {
    // Prevent duplicate prompt within 2 seconds (double-enter protection)
    const hash = this.simpleHash(content);
    const now = Date.now();
    const lastSeen = this._recentUserHashes.get(hash);
    
    // Cleanup old hashes (older than 5s)
    for (const [h, ts] of this._recentUserHashes) {
      if (now - ts > 5000) this._recentUserHashes.delete(h);
    }
    
    if (lastSeen && now - lastSeen < 2000) {
      // Same prompt within 2s — likely double-enter, skip
      return false;
    }
    
    // Also check if last user message is identical (immediate duplicate)
    if (this._lastUserContent === content && this.messages.length > 0) {
      const lastMsg = this.messages[this.messages.length - 1];
      // If last message is user with same content, skip
      if (lastMsg.role === 'user' && lastMsg.content === content) {
        return false;
      }
      // If we just had user->assistant->... and user repeats same, check timing
      const recentUserMsgs = this.messages.filter(m => m.role === 'user').slice(-2);
      if (recentUserMsgs.length > 0 && recentUserMsgs[recentUserMsgs.length - 1].content === content) {
        // Check if last assistant response was recent (< 3s ago) — might be accidental double send
        // We still allow it but log
      }
    }
    
    this._recentUserHashes.set(hash, now);
    this._lastUserContent = content;
    this.messages.push({ role: 'user', content });
    return true;
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
          if (typeof parsed.content === 'string' && parsed.content.length > 500) {
            const origLen = parsed.content.length;
            parsed.content = parsed.content.slice(0, 300) + `\n...[${origLen - 600} chars truncated]...\n` + parsed.content.slice(-300);
            argsStr = JSON.stringify(parsed);
          } else if (typeof parsed.old_string === 'string' && parsed.old_string.length > 500) {
            parsed.old_string = parsed.old_string.slice(0, 200) + `...[${parsed.old_string.length} chars truncated]`;
            argsStr = JSON.stringify(parsed);
          } else if (typeof parsed.new_string === 'string' && parsed.new_string.length > 500) {
            parsed.new_string = parsed.new_string.slice(0, 200) + `...[${parsed.new_string.length} chars truncated]`;
            argsStr = JSON.stringify(parsed);
          }
        } catch {
          argsStr = argsStr.slice(0, MAX_TOOL_ARG_CHARS) + '...}';
        }
        if (argsStr.length > MAX_TOOL_ARG_CHARS) {
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

    // FIX: Removed aggressive file read dedup that caused model to retry
    // Old code replaced duplicate file reads with reference message, causing model to re-read and waste tokens
    // Now we just truncate, keeping actual content

    if (content.length > MAX_TOOL_RESULT_CHARS) {
      const lines = content.split('\n');
      if (lines.length > MAX_TOOL_RESULT_LINES) {
        const head = lines.slice(0, 50).join('\n');
        const tail = lines.slice(-20).join('\n');
        content = `${head}\n... [${lines.length - 70} lines, ${content.length - head.length - tail.length} chars truncated for efficiency] ...\n${tail}`;
      } else {
        const head = content.slice(0, 1500);
        const tail = content.slice(-1000);
        content = `${head}\n... [${content.length - 2500} chars truncated] ...\n${tail}`;
      }
    }

    this.messages.push({
      role: 'tool',
      content,
      tool_call_id: toolCallId,
      name,
    });
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 1000); i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
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
    while (this.estimateTokens() > this._maxTokens - RESERVED_TOKENS && this.messages.length > 4) {
      const systemMsgs = this.messages.filter(m => m.role === 'system');
      const nonSystem = this.messages.filter(m => m.role !== 'system');
      
      if (nonSystem.length <= 4) break;
      
      const toRemove = Math.min(2, nonSystem.length - 4);
      let removed = 0;
      const newMessages: Message[] = [...systemMsgs];
      
      for (const msg of this.messages) {
        if (msg.role === 'system') continue;
        if (removed < toRemove && nonSystem.indexOf(msg) < toRemove) {
          removed++;
          continue;
        }
        newMessages.push(msg);
      }
      
      this.messages = newMessages;
      
      if (this.estimateTokens() > this._maxTokens - RESERVED_TOKENS) {
        for (let i = systemMsgs.length; i < this.messages.length; i++) {
          if (this.messages[i].role === 'tool' && this.messages[i].content.length > 500) {
            this.messages[i].content = this.messages[i].content.slice(0, 500) + '...[truncated]';
          }
        }
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
    this._recentUserHashes.clear();
    this._lastUserContent = '';
  }

  get length(): number {
    return this.messages.length;
  }

  toJSON(): string {
    return JSON.stringify(this.messages);
  }
}
