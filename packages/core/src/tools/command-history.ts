import type { CommandRecord } from './types.js';

export class CommandHistory {
  private records: CommandRecord[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  add(record: CommandRecord): void {
    this.records.push({
      ...record,
      timestamp: record.timestamp ?? new Date().toISOString(),
    });

    if (this.records.length > this.maxSize) {
      this.records = this.records.slice(-this.maxSize);
    }
  }

  getAll(): CommandRecord[] {
    return [...this.records];
  }

  getRecent(count = 10): CommandRecord[] {
    return this.records.slice(-count);
  }

  getLast(): CommandRecord | null {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null;
  }

  getSummary(): string {
    if (this.records.length === 0) {
      return 'No commands executed yet.';
    }

    const successful = this.records.filter(r => r.status === 'success').length;
    const failed = this.records.filter(r => r.status === 'failed').length;
    const killed = this.records.filter(r => r.status === 'killed' || r.status === 'timeout').length;
    const totalDuration = this.records.reduce((sum, r) => sum + r.durationMs, 0);

    const lines: string[] = [
      `Commands executed: ${this.records.length}`,
      `Successful: ${successful}`,
      `Failed: ${failed}`,
      `Killed/Timeout: ${killed}`,
      `Total duration: ${(totalDuration / 1000).toFixed(1)}s`,
    ];

    const lastFew = this.records.slice(-5);
    if (lastFew.length > 0) {
      lines.push('', 'Recent commands:');
      for (const r of lastFew) {
        const preview = r.outputPreview ?? r.output?.slice(0, 100) ?? '';
        lines.push(`  ${r.status === 'success' ? '✓' : '✗'} ${r.command} (${(r.durationMs / 1000).toFixed(1)}s)`);
        if (preview) {
          lines.push(`    → ${preview}`);
        }
      }
    }

    return lines.join('\n');
  }

  clear(): void {
    this.records = [];
  }

  get size(): number {
    return this.records.length;
  }
}
