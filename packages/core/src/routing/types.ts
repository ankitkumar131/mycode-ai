export interface ProviderConfig {
  name: string;
  /** API adapter name, or "cli"/"munder" for an external agent command. */
  apiProvider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  read?: boolean;
  write?: boolean;
  maxRetries?: number;
  /** External CLI executable used by the Munder-style adapter. */
  command?: string;
  /** Arguments passed to the external CLI. Supports {model} and {prompt} placeholders. */
  args?: string[];
  /** Extra environment variables for an external CLI provider. */
  env?: Record<string, string>;
  /** External provider timeout in milliseconds. */
  timeout?: number;
}

export interface ProviderStats {
  name: string;
  model: string;
  priority: number;
  status: 'active' | 'fallback' | 'error';
  latency?: number;
  successCount?: number;
  failureCount?: number;
  lastError?: string;
}

export interface ProviderHealth {
  successCount: number;
  failureCount: number;
  lastError?: string;
  isAvailable: boolean;
}

export type SafetyLevel = 'blocked' | 'dangerous' | 'elevated' | 'normal';

export interface SafetyResult {
  level: SafetyLevel;
  reason?: string;
  warnings?: string[];
}
