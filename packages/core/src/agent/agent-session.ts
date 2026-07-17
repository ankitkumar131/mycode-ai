import { EventTranslator } from './event-translator.js';
import type { AgentOptions, AgentEvent } from './types.js';

export class AgentSession {
  private options: AgentOptions;
  public translator: EventTranslator;

  constructor(options: AgentOptions) {
    this.options = options;
    this.translator = new EventTranslator();
  }

  async run(input: string): Promise<string> {
    return '';
  }

  abort(): void {}

  getState() {
    return { running: false, iterations: 0 };
  }
}
