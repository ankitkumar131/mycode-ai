export interface A2AConfig {
  port: number;
  host: string;
}

export interface A2AClient {
  id: string;
  capabilities: string[];
}
