import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface RunRecord {
  id: string;
  sessionId: string;
  cwd: string;
  provider?: string;
  agent?: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  turns?: number;
  toolCalls?: number;
  filesTouched?: string[];
  error?: string;
}

/**
 * Lightweight durable run ledger inspired by Paperclip's audit/recovery
 * records. JSON keeps it usable without adding a database or server to MyCode.
 */
export class RunLedger {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir() || process.env.HOME || '.', '.mycode', 'runs');
  }

  getDir(): string {
    return this.dir;
  }

  private ensure(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  }

  start(input: Omit<RunRecord, 'id' | 'status' | 'startedAt'> & { id?: string }): string {
    this.ensure();
    const id = input.id ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
    const record: RunRecord = {
      ...input,
      id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    writeFileSync(this.fileFor(id), JSON.stringify(record, null, 2) + '\n', 'utf8');
    return id;
  }

  update(id: string, patch: Partial<RunRecord>): RunRecord | null {
    const current = this.load(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.ensure();
    writeFileSync(this.fileFor(id), JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  finish(id: string, patch: Partial<RunRecord> = {}): RunRecord | null {
    return this.update(id, { ...patch, finishedAt: patch.finishedAt ?? new Date().toISOString() });
  }

  load(id: string): RunRecord | null {
    const file = this.fileFor(id);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as RunRecord;
    } catch {
      return null;
    }
  }

  list(limit = 50): RunRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          return JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as RunRecord;
        } catch {
          return null;
        }
      })
      .filter((record): record is RunRecord => !!record)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, limit);
  }
}

export const runLedger = new RunLedger();
