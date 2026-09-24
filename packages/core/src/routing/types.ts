export interface ProviderConfig {
  name: string;
  apiProvider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  read?: boolean;
  write?: boolean;
  maxRetries?: number;
  /**
   * Cap on generated tokens per response.
   *
   * Defaults to DEFAULT_MAX_OUTPUT_TOKENS. The old hard-coded 4096 was too low
   * for agentic work: writing a React component as a `write_file` tool call
   * routinely exceeds it, the response is truncated mid-JSON, the arguments
   * fail to parse, and the turn ends having done nothing visible.
   */
  maxOutputTokens?: number;
}

export interface ProviderStats {
  name: string;
  model: string;
  priority: number;
  status: 'active' | 'fallback' | 'error';
  latency?: number;
  /** Last failure message, when the provider is currently failing. */
  lastError?: string;
  /** Milliseconds left on the cooldown. 0 when the provider is ready. */
  cooldownRemainingMs?: number;
}

export interface ProviderHealth {
  successCount: number;
  failureCount: number;
  lastError?: string;
  isAvailable: boolean;
  /** Epoch ms before which this provider is skipped. 0 means ready now. */
  cooldownUntil?: number;
}

export type SafetyLevel = 'blocked' | 'dangerous' | 'elevated' | 'normal';

export interface SafetyResult {
  level: SafetyLevel;
  reason?: string;
  warnings?: string[];
}
