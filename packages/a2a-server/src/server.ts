import type { A2AConfig, A2AClient } from './types.js';

export class A2AServer {
  constructor(private config: A2AConfig) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}
