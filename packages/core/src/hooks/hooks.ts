import type { HookDefinition, HookEvent } from './types.js';

export class HookAggregator {
  private hooks: Map<string, HookDefinition[]> = new Map();

  register(event: string, hook: HookDefinition): void {
    const hooks = this.hooks.get(event) || [];
    hooks.push(hook);
    this.hooks.set(event, hooks);
  }

  getHooks(event: string): HookDefinition[] {
    return this.hooks.get(event) || [];
  }
}

export class HookRunner {
  constructor(private aggregator: HookAggregator) {}

  async run(event: HookEvent): Promise<void> {}
}
