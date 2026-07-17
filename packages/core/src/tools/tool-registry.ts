import type { ToolDefinition, ToolHandler } from './types.js';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(name: string, definition: ToolDefinition): void {
    this.tools.set(name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll();
  }
}
