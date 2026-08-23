import type { MCPConfig, MCPServerConfig, MCPToolInfo } from './types.js';

export class MCPClient {
  constructor(public config: MCPServerConfig) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      server: this.config.name,
      tool: name,
      status: 'executed',
      args,
    });
  }

  async listTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: `${this.config.name}_health`,
        description: `Check health of MCP server ${this.config.name}`,
        serverName: this.config.name,
      },
    ];
  }

  async disconnect(): Promise<void> {
    this.config.status = 'disconnected';
  }
}

export class MCPClientManager {
  private clients: Map<string, MCPClient> = new Map();
  private servers: MCPServerConfig[] = [];

  constructor(config?: MCPConfig) {
    if (config?.servers) {
      this.servers = config.servers;
      for (const s of config.servers) {
        this.clients.set(s.name, new MCPClient(s));
      }
    }
  }

  async initialize(): Promise<void> {
    for (const client of this.clients.values()) {
      client.config.status = 'connected';
    }
  }

  listServers(): MCPServerConfig[] {
    return this.servers;
  }

  addServer(server: MCPServerConfig): void {
    this.servers.push(server);
    this.clients.set(server.name, new MCPClient(server));
  }

  removeServer(name: string): boolean {
    const idx = this.servers.findIndex((s) => s.name === name);
    if (idx !== -1) {
      this.servers.splice(idx, 1);
      this.clients.delete(name);
      return true;
    }
    return false;
  }

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  async listAllTools(): Promise<MCPToolInfo[]> {
    const tools: MCPToolInfo[] = [];
    for (const client of this.clients.values()) {
      if (client.config.status === 'connected') {
        const clientTools = await client.listTools();
        tools.push(...clientTools);
      }
    }
    return tools;
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
  }
}

export const mcpManager = new MCPClientManager();
