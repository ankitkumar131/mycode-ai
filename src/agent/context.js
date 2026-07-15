/**
 * Context Manager
 * Manages conversation history, token counting, and context window limits.
 */

/**
 * Simple token estimator (rough approximation: 1 token ≈ 4 chars).
 * Good enough for context window management without requiring tiktoken.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a message object.
 * @param {object} msg - { role, content, tool_calls? }
 * @returns {number}
 */
function messageTokens(msg) {
  let tokens = 4; // Every message has overhead
  tokens += estimateTokens(msg.role);
  tokens += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));

  if (msg.tool_calls) {
    tokens += estimateTokens(JSON.stringify(msg.tool_calls));
  }

  return tokens;
}

export class ConversationContext {
  /**
   * @param {object} options
   * @param {number} options.maxTokens - Maximum context window size (default: 100k)
   * @param {number} options.reserveTokens - Tokens to reserve for response (default: 4096)
   */
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 100_000;
    this.reserveTokens = options.reserveTokens || 4096;
    this.messages = [];
    this.systemPrompt = '';
    this._totalTokens = 0;
  }

  /**
   * Set the system prompt.
   * @param {string} prompt
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    this._recalculate();
  }

  /**
   * Add a message to the conversation.
   * @param {object} msg - { role: 'user'|'assistant'|'tool', content, tool_calls?, tool_call_id? }
   */
  addMessage(msg) {
    this.messages.push(msg);
    this._totalTokens += messageTokens(msg);

    // If we're over the limit, trim old messages
    this._trimIfNeeded();
  }

  /**
   * Get all messages formatted for the API call.
   * @returns {Array} Messages including system prompt
   */
  getMessages() {
    const msgs = [];

    if (this.systemPrompt) {
      msgs.push({ role: 'system', content: this.systemPrompt });
    }

    msgs.push(...this.messages);
    return msgs;
  }

  /**
   * Get the estimated token count.
   * @returns {number}
   */
  getTokenCount() {
    return this._totalTokens;
  }

  /**
   * Get the number of messages in history.
   * @returns {number}
   */
  getMessageCount() {
    return this.messages.length;
  }

  /**
   * Clear all messages (keep system prompt).
   */
  clear() {
    this.messages = [];
    this._recalculate();
  }

  /**
   * Get the last N messages.
   * @param {number} n
   * @returns {Array}
   */
  getLastMessages(n) {
    return this.messages.slice(-n);
  }

  /**
   * Trim old messages to stay within context limits.
   * Preserves the first user message and all recent messages.
   */
  _trimIfNeeded() {
    const limit = this.maxTokens - this.reserveTokens;

    while (this._totalTokens > limit && this.messages.length > 2) {
      // Remove the second message (keep the first user message for context)
      // But if it's part of a tool call chain, remove the whole chain
      const removed = this.messages.splice(1, 1)[0];
      this._totalTokens -= messageTokens(removed);

      // Also remove any orphaned tool responses
      if (removed.role === 'assistant' && removed.tool_calls) {
        const callIds = removed.tool_calls.map((tc) => tc.id);
        this.messages = this.messages.filter((m) => {
          if (m.role === 'tool' && callIds.includes(m.tool_call_id)) {
            this._totalTokens -= messageTokens(m);
            return false;
          }
          return true;
        });
      }
    }
  }

  /**
   * Recalculate total tokens from scratch.
   */
  _recalculate() {
    this._totalTokens = estimateTokens(this.systemPrompt);
    for (const msg of this.messages) {
      this._totalTokens += messageTokens(msg);
    }
  }
}
