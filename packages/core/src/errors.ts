export class RateLimitError extends Error {
  providerName: string;
  retryAfterMs: number | null;

  constructor(providerName: string, retryAfterMs: number | null = null) {
    super(`Rate limit exceeded for provider: ${providerName}`);
    this.name = 'RateLimitError';
    this.providerName = providerName;
    this.retryAfterMs = retryAfterMs;
  }
}

export class AuthError extends Error {
  providerName: string;

  constructor(providerName: string) {
    super(`Authentication failed for provider: ${providerName}. Check your API key.`);
    this.name = 'AuthError';
    this.providerName = providerName;
  }
}

export class ContextLengthError extends Error {
  providerName: string;
  maxTokens?: number;

  constructor(providerName: string, maxTokens?: number) {
    super(`Context length exceeded for provider: ${providerName}${maxTokens ? ` (max: ${maxTokens})` : ''}`);
    this.name = 'ContextLengthError';
    this.providerName = providerName;
    this.maxTokens = maxTokens;
  }
}

export class ProviderServerError extends Error {
  providerName: string;
  statusCode: number;

  constructor(providerName: string, statusCode: number) {
    super(`Server error from provider: ${providerName} (HTTP ${statusCode})`);
    this.name = 'ProviderServerError';
    this.providerName = providerName;
    this.statusCode = statusCode;
  }
}

export class AllProvidersExhaustedError extends Error {
  errors: Error[];

  constructor(errors: Error[] = []) {
    const summary = errors
      .map((e: any) => `  \u2022 ${e.providerName || 'unknown'}: ${e.message}`)
      .join('\n');
    super(`All providers failed:\n${summary}`);
    this.name = 'AllProvidersExhaustedError';
    this.errors = errors;
  }
}

export class NoProvidersConfiguredError extends Error {
  constructor() {
    super('No providers configured. Run `mycode init` to set up your first provider.');
    this.name = 'NoProvidersConfiguredError';
  }
}

export class ToolExecutionError extends Error {
  toolName: string;

  constructor(toolName: string, reason: string) {
    super(`Tool "${toolName}" failed: ${reason}`);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

export function classifyError(err: any, providerName: string): Error {
  const status = err.status || err.statusCode || err?.response?.status;
  const message: string = err.message || '';

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

  const wrapped = new Error(`Provider "${providerName}" error: ${message}`);
  (wrapped as any).providerName = providerName;
  (wrapped as any).originalError = err;
  return wrapped;
}
