export interface MCPServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  env?: Record<string, string>;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverName: string;
  parameters?: Record<string, unknown>;
}
