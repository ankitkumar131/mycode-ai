import type { AgentConfig } from './types.js';

export class MyCodeAgent {
  constructor(private config: AgentConfig) {}

  async run(input: string): Promise<string> {
    return '';
  }
}
