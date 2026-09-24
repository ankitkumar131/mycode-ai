import { describe, it, expect } from 'vitest';
import {
  classifyError,
  AllProvidersExhaustedError,
  AuthError,
  ProviderGoneError,
  RateLimitError,
  ProviderServerError,
  ContextLengthError,
} from './errors.js';

describe('classifyError', () => {
  it('maps HTTP 410 to ProviderGoneError', () => {
    const err = classifyError({ status: 410, message: 'no body' }, 'nvidia/llama');
    expect(err).toBeInstanceOf(ProviderGoneError);
    expect((err as ProviderGoneError).statusCode).toBe(410);
    expect((err as ProviderGoneError).providerName).toBe('nvidia/llama');
  });

  it('maps HTTP 404 to ProviderGoneError', () => {
    const err = classifyError({ statusCode: 404, message: 'Not Found' }, 'nvidia/gemma');
    expect(err).toBeInstanceOf(ProviderGoneError);
    expect((err as ProviderGoneError).statusCode).toBe(404);
  });

  it('reads the status off the nested response object', () => {
    const err = classifyError({ response: { status: 410 }, message: 'Gone' }, 'p');
    expect(err).toBeInstanceOf(ProviderGoneError);
  });

  it('still maps 429 to RateLimitError', () => {
    const err = classifyError({ status: 429, message: 'Too Many Requests' }, 'openrouter/free');
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(ProviderGoneError);
  });

  it('still maps 401/403 to AuthError', () => {
    expect(classifyError({ status: 401, message: 'x' }, 'p')).toBeInstanceOf(AuthError);
    expect(classifyError({ status: 403, message: 'x' }, 'p')).toBeInstanceOf(AuthError);
  });

  it('still maps 5xx to ProviderServerError', () => {
    const err = classifyError({ status: 503, message: 'unavailable' }, 'p');
    expect(err).toBeInstanceOf(ProviderServerError);
    expect(err).not.toBeInstanceOf(ProviderGoneError);
  });

  it('still maps context-length text to ContextLengthError', () => {
    expect(classifyError({ message: 'maximum context length exceeded' }, 'p')).toBeInstanceOf(
      ContextLengthError
    );
  });

  it('wraps unknown failures without inventing a status', () => {
    const err = classifyError({ message: 'ECONNRESET' }, 'p');
    expect(err.name).toBe('Error');
    expect(err).not.toBeInstanceOf(ProviderGoneError);
  });
});

describe('AllProvidersExhaustedError', () => {
  it('adds a how-to-fix hint when the chain includes a dead endpoint', () => {
    const err = new AllProvidersExhaustedError([
      new ProviderGoneError('nvidia/llama', 410),
      new RateLimitError('openrouter/free', null),
    ]);
    expect(err.message).toContain('How to fix:');
    expect(err.message).toContain('HTTP 410');
    expect(err.message).toContain('quota');
  });

  it('mentions the API key when an auth error is present', () => {
    const err = new AllProvidersExhaustedError([new AuthError('pokee')]);
    expect(err.message).toContain('/config');
  });

  it('omits the hint block when every failure is transient', () => {
    const err = new AllProvidersExhaustedError([new ProviderServerError('p', 503)]);
    expect(err.message).not.toContain('How to fix:');
  });
});
