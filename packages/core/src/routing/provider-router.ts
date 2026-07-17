import { BaseProvider } from './base-provider.js';
import type { ProviderConfig, ProviderStats } from './types.js';

export class ProviderRouter {
  private providers: BaseProvider[] = [];

  constructor(configs: ProviderConfig[]) {}

  getCurrentProvider(): BaseProvider | null {
    return this.providers[0] ?? null;
  }

  getStats(): ProviderStats[] {
    return [];
  }

  async chat(messages: unknown[], tools?: unknown[]): Promise<unknown> {
    return {};
  }

  async stream(messages: unknown[], tools?: unknown[]) {
    return (async function* () {})();
  }

  setActiveProvider(name: string): boolean {
    return true;
  }
}
