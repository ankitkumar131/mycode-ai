/**
 * Custom Error Types
 * Structured errors for provider failures, config issues, etc.
 */

/**
 * Thrown when a provider returns a rate limit error (HTTP 429).
 */
export class RateLimitError extends Error {
  constructor(providerName, retryAfterMs = null) {
    super(`Rate limit exceeded for provider: ${providerName}`);
    this.name = 'RateLimitError';
    this.providerName = providerName;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when a provider returns an authentication error (HTTP 401/403).
 */
export class AuthError extends Error {
  constructor(providerName) {
    super(`Authentication failed for provider: ${providerName}. Check your API key.`);
    this.name = 'AuthError';
    this.providerName = providerName;
  }
}

/**
 * Thrown when the input exceeds the model's context window.
 */
export class ContextLengthError extends Error {
  constructor(providerName, maxTokens) {
    super(`Context length exceeded for provider: ${providerName} (max: ${maxTokens})`);
    this.name = 'ContextLengthError';
    this.providerName = providerName;
    this.maxTokens = maxTokens;
  }
}

/**
 * Thrown when a provider returns a server error (HTTP 5xx).
 */
export class ProviderServerError extends Error {
  constructor(providerName, statusCode) {
    super(`Server error from provider: ${providerName} (HTTP ${statusCode})`);
    this.name = 'ProviderServerError';
    this.providerName = providerName;
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when all providers have been exhausted.
 */
export class AllProvidersExhaustedError extends Error {
  constructor(errors = []) {
    const summary = errors
      .map((e) => `  • ${e.providerName || 'unknown'}: ${e.message}`)
      .join('\n');
    super(`All providers failed:\n${summary}`);
    this.name = 'AllProvidersExhaustedError';
    this.errors = errors;
  }
}

/**
 * Thrown when the user hasn't configured any providers.
 */
export class NoProvidersConfiguredError extends Error {
  constructor() {
    super('No providers configured. Run `mycode init` to set up your first provider.');
    this.name = 'NoProvidersConfiguredError';
  }
}

/**
 * Thrown when a tool execution fails.
 */
export class ToolExecutionError extends Error {
  constructor(toolName, reason) {
    super(`Tool "${toolName}" failed: ${reason}`);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

/**
 * Classify an API error into one of our custom types.
 * @param {Error} err - The raw error from the SDK
 * @param {string} providerName - Name of the provider that errored
 * @returns {Error} A classified error
 */
export function classifyError(err, providerName) {
  const status = err.status || err.statusCode || err?.response?.status;
  const message = err.message || '';

  if (status === 429 || message.includes('rate limit') || message.includes('Rate limit')) {
    const retryAfter = err.headers?.['retry-after']
      ? parseInt(err.headers['retry-after'], 10) * 1000
      : null;
    return new RateLimitError(providerName, retryAfter);
  }

  if (status === 401 || status === 403 || message.includes('auth') || message.includes('Unauthorized')) {
    return new AuthError(providerName);
  }

  if (
    message.includes('context length') ||
    message.includes('maximum context') ||
    message.includes('token limit') ||
    message.includes('max_tokens')
  ) {
    return new ContextLengthError(providerName);
  }

  if (status >= 500 && status < 600) {
    return new ProviderServerError(providerName, status);
  }

  // Unknown error — wrap it with provider context
  const wrapped = new Error(`Provider "${providerName}" error: ${message}`);
  wrapped.providerName = providerName;
  wrapped.originalError = err;
  return wrapped;
}
