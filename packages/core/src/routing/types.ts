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
   * Explicit context window in tokens. When omitted it is inferred from the
   * model name by `effectiveWindowFor()` in routing/failover.ts. Setting this
   * is the reliable option: an inferred window that is too large causes a hard
   * overflow mid-task, and one that is too small causes premature compaction.
   */
  contextWindow?: number;
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
