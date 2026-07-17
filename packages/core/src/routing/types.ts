export interface ProviderConfig {
  name: string;
  apiProvider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  maxRetries?: number;
}

export interface ProviderStats {
  name: string;
  model: string;
  priority: number;
  status: 'active' | 'fallback' | 'error';
  latency?: number;
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
