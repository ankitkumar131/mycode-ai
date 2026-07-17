import type { MCPConfig, MCPServerConfig } from './types.js';

export class MCPClient {
  constructor(private config: MCPServerConfig) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return '';
  }

  async listTools(): Promise<string[]> {
    return [];
  }

  async disconnect(): Promise<void> {}
}

export class MCPClientManager {
  private clients: Map<string, MCPClient> = new Map();

  constructor(config: MCPConfig) {}

  async initialize(): Promise<void> {}

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  async disconnectAll(): Promise<void> {}
}
