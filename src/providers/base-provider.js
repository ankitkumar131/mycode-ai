/**
 * Base Provider — Abstract interface all providers must implement.
 * Provides a consistent API for the Router regardless of the underlying AI service.
 */

export class BaseProvider {
  /**
   * @param {object} config - Provider configuration from settings.json
   */
  constructor(config) {
    this.name = config.name;
    this.priority = config.priority;
    this.model = config.model;
    this.apiProvider = config.api_provider;
    this.canRead = config.read !== false;
    this.canWrite = config.write !== false;
    this.maxRetries = config.max_retries || 3;
    this.baseUrl = config.base_url || '';
    this.apiKey = config.api_key || '';

    // Health tracking
    this._successCount = 0;
    this._failureCount = 0;
    this._lastError = null;
    this._isAvailable = true;
  }

  /**
   * Send a chat completion request (non-streaming).
   * @param {Array} messages - Conversation history [{role, content}]
   * @param {Array} tools - Tool definitions for function calling
   * @param {object} options - Additional options (temperature, max_tokens, etc.)
   * @returns {Promise<object>} { content, tool_calls, usage }
   */
  async chat(messages, tools = [], options = {}) {
    throw new Error(`chat() not implemented by provider: ${this.name}`);
  }

  /**
   * Send a streaming chat completion request.
   * @param {Array} messages - Conversation history
   * @param {Array} tools - Tool definitions
   * @param {object} options - Additional options
   * @returns {AsyncGenerator} Yields {type, content, tool_call} chunks
   */
  async *stream(messages, tools = [], options = {}) {
    throw new Error(`stream() not implemented by provider: ${this.name}`);
  }

  /**
   * Check if this provider supports tool/function calling.
   * @returns {boolean}
   */
  supportsTools() {
    return true;
  }

  /**
   * Test connectivity to this provider.
   * @returns {Promise<{ok: boolean, latencyMs: number, error?: string}>}
   */
  async healthCheck() {
    const start = Date.now();
    try {
      await this.chat(
        [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        [],
        { max_tokens: 5 }
      );
      const latencyMs = Date.now() - start;
      this.recordSuccess();
      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.recordFailure(err);
      return { ok: false, latencyMs, error: err.message };
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess() {
    this._successCount++;
    this._isAvailable = true;
  }

  /**
   * Record a failed request.
   * @param {Error} err
   */
  recordFailure(err) {
    this._failureCount++;
    this._lastError = err;
  }

  /**
   * Mark provider as temporarily unavailable.
   */
  markUnavailable() {
    this._isAvailable = false;
  }

  /**
   * Check if provider is currently available.
   * @returns {boolean}
   */
  isAvailable() {
    return this._isAvailable;
  }

  /**
   * Get provider stats.
   * @returns {object}
   */
  getStats() {
    return {
      name: this.name,
      model: this.model,
      priority: this.priority,
      available: this._isAvailable,
      successes: this._successCount,
      failures: this._failureCount,
      lastError: this._lastError?.message || null,
    };
  }

  /**
   * Get a display label for this provider.
   * @returns {string}
   */
  getLabel() {
    return `${this.name} (${this.model})`;
  }
}
