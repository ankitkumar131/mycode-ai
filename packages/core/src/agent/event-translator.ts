import type { AgentEvent } from './types.js';

export class EventTranslator {
  translate(event: AgentEvent): string {
    return JSON.stringify(event);
  }
}
