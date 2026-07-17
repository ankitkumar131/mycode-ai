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
