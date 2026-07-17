import type { OutputFormat } from './types.js';

export class OutputFormatter {
  constructor(private format: OutputFormat = 'text') {}

  formatText(content: string): string {
    return content;
  }

  formatJSON(data: unknown): string {
    return JSON.stringify(data);
  }

  formatStreamJSON(event: string, data: unknown): string {
    return JSON.stringify({ event, data }) + '\n';
  }

  setFormat(format: OutputFormat): void {
    this.format = format;
  }
}
