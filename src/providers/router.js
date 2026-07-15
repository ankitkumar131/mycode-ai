/**
 * Provider Router — Priority-Based Failover Engine
 *
 * The core innovation of MyCode. Routes requests to providers based on priority,
 * automatically failing over to the next provider when errors occur.
 *
 * Failover triggers:
 *   - Rate limit (HTTP 429) → wait briefly, then next provider
 *   - Server error (HTTP 5xx) → immediate next provider
 *   - Auth error (401/403) → skip provider, warn user
 *   - Context length exceeded → try next provider (may have larger window)
 *   - Connection refused → skip provider (offline)
 *
 * Permission filtering:
 *   - If task requires writing and provider has write:false → skip
 *   - If task requires reading and provider has read:false → skip
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama-provider.js';
import {
  RateLimitError,
  AuthError,
  ContextLengthError,
  ProviderServerError,
  AllProvidersExhaustedError,
  NoProvidersConfiguredError,
} from '../utils/errors.js';
import logger from '../utils/logger.js';

export class ProviderRouter {
  /**
   * @param {Array} providerConfigs - Array of provider configs from settings.json
   */
  constructor(providerConfigs = []) {
    if (!providerConfigs.length) {
      throw new NoProvidersConfiguredError();
    }

    // Sort by priority and instantiate provider classes
    this.providers = providerConfigs
      .sort((a, b) => a.priority - b.priority)
      .map((config) => this._createProvider(config));

    this._currentIndex = 0;
  }

  /**
   * Create the appropriate provider instance based on api_provider type.
   */
  _createProvider(config) {
    switch (config.api_provider) {
      case 'ollama':
        return new OllamaProvider(config);

      case 'openrouter':
      case 'nvidia_nim':
      case 'openai':
      case 'custom':
      default:
        // All OpenAI-compatible endpoints use the same adapter
        return new OpenAICompatibleProvider(config);
    }
  }

  /**
   * Get available providers filtered by required permissions.
   * @param {object} requirements - { needsWrite: bool, needsRead: bool }
   * @returns {Array<BaseProvider>}
   */
  _getEligibleProviders(requirements = {}) {
    return this.providers.filter((p) => {
      if (!p.isAvailable()) return false;
      if (requirements.needsWrite && !p.canWrite) return false;
      if (requirements.needsRead && !p.canRead) return false;
      return true;
    });
  }

  /**
   * Get the currently active provider.
   * @returns {BaseProvider}
   */
  getCurrentProvider() {
    return this.providers[this._currentIndex] || this.providers[0];
  }

  /**
   * Send a non-streaming chat request with automatic failover.
   * @param {Array} messages - Conversation history
   * @param {Array} tools - Tool definitions
   * @param {object} options - { temperature, max_tokens, needsWrite, needsRead }
   * @returns {Promise<object>} Response from the first successful provider
   */
  async chat(messages, tools = [], options = {}) {
    const eligible = this._getEligibleProviders(options);

    if (eligible.length === 0) {
      // Reset all providers and try again
      this.providers.forEach((p) => (p._isAvailable = true));
      const retryEligible = this._getEligibleProviders(options);
      if (retryEligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
      return this._attemptWithFailover(retryEligible, 'chat', messages, tools, options);
    }

    return this._attemptWithFailover(eligible, 'chat', messages, tools, options);
  }

  /**
   * Send a streaming chat request with automatic failover.
   * Note: If a provider fails mid-stream, we failover to the next and restart the stream.
   */
  async *stream(messages, tools = [], options = {}) {
    const eligible = this._getEligibleProviders(options);

    if (eligible.length === 0) {
      this.providers.forEach((p) => (p._isAvailable = true));
      const retryEligible = this._getEligibleProviders(options);
      if (retryEligible.length === 0) {
        throw new NoProvidersConfiguredError();
      }
      yield* this._attemptStreamWithFailover(retryEligible, messages, tools, options);
      return;
    }

    yield* this._attemptStreamWithFailover(eligible, messages, tools, options);
  }

  /**
   * Attempt a non-streaming request, failing over through providers.
   */
  async _attemptWithFailover(providers, method, messages, tools, options) {
    const errors = [];

    for (const provider of providers) {
      try {
        logger.provider(`Using ${provider.getLabel()}`);
        const result = await provider.chat(messages, tools, options);
        this._currentIndex = this.providers.indexOf(provider);
        return result;
      } catch (err) {
        errors.push(err);
        this._handleProviderError(provider, err, providers);
      }
    }

    throw new AllProvidersExhaustedError(errors);
  }

  /**
   * Attempt a streaming request, failing over through providers.
   */
  async *_attemptStreamWithFailover(providers, messages, tools, options) {
    const errors = [];

    for (const provider of providers) {
      try {
        logger.provider(`Using ${provider.getLabel()}`);
        const gen = provider.stream(messages, tools, options);

        for await (const chunk of gen) {
          yield chunk;
        }

        this._currentIndex = this.providers.indexOf(provider);
        return; // Successful stream completed
      } catch (err) {
        errors.push(err);
        this._handleProviderError(provider, err, providers);
      }
    }

    throw new AllProvidersExhaustedError(errors);
  }

  /**
   * Handle a provider error — decide whether to failover or propagate.
   */
  _handleProviderError(provider, err, remainingProviders) {
    const nextProvider = remainingProviders[remainingProviders.indexOf(provider) + 1];
    const nextLabel = nextProvider ? nextProvider.getLabel() : 'none available';

    if (err instanceof RateLimitError) {
      logger.switch(provider.getLabel(), nextLabel, 'rate limit');
      provider.markUnavailable();
    } else if (err instanceof AuthError) {
      logger.switch(provider.getLabel(), nextLabel, 'auth error — check API key');
      provider.markUnavailable();
    } else if (err instanceof ContextLengthError) {
      logger.switch(provider.getLabel(), nextLabel, 'context too long');
      // Don't mark unavailable — might work for shorter inputs
    } else if (err instanceof ProviderServerError) {
      logger.switch(provider.getLabel(), nextLabel, `server error (${err.statusCode})`);
      provider.markUnavailable();
    } else {
      logger.switch(provider.getLabel(), nextLabel, err.message || 'unknown error');
      provider.markUnavailable();
    }
  }

  /**
   * Test connectivity to all providers.
   * @returns {Promise<Array<{name, model, ok, latencyMs, error?}>>}
   */
  async testAll() {
    const results = [];
    for (const provider of this.providers) {
      const result = await provider.healthCheck();
      results.push({
        name: provider.name,
        model: provider.model,
        priority: provider.priority,
        ...result,
      });
    }
    return results;
  }

  /**
   * Reset all provider availability (e.g., after some time has passed).
   */
  resetAll() {
    this.providers.forEach((p) => {
      p._isAvailable = true;
      p._failureCount = 0;
    });
    this._currentIndex = 0;
  }

  /**
   * Get stats for all providers.
   */
  getStats() {
    return this.providers.map((p) => p.getStats());
  }
}
