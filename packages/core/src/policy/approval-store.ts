import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type ApprovalScope = 'session' | 'project' | 'global';
export type ApprovalAction = 'run_command' | 'write_file' | 'edit_file' | string;

export interface ApprovalRecord {
  action: ApprovalAction;
  pattern: string;
  scope: Exclude<ApprovalScope, 'session'>;
  cwd?: string;
  createdAt: string;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function matches(resource: string, pattern: string): boolean {
  const input = normalize(resource);
  const expected = normalize(pattern);
  return input === expected || input.startsWith(expected + ' ');
}

/**
 * Small durable approval store inspired by Paperclip's persistent control
 * records. It is intentionally independent of the provider and survives CLI
 * restarts without turning approvals into a blanket "allow everything" flag.
 */
export class ApprovalStore {
  private readonly file: string;
  private readonly session = new Map<string, Set<string>>();
  private records: ApprovalRecord[] | null = null;

  constructor(file?: string) {
    this.file = file ?? join(homedir() || process.env.HOME || '.', '.mycode', 'approvals.json');
  }

  getPath(): string {
    return this.file;
  }

  private readPersistent(): ApprovalRecord[] {
    if (this.records) return this.records;
    if (!existsSync(this.file)) {
      this.records = [];
      return this.records;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.records = Array.isArray(parsed) ? parsed.filter(this.isRecord) : [];
    } catch {
      this.records = [];
    }
    return this.records;
  }

  private isRecord(value: unknown): value is ApprovalRecord {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.action === 'string' && typeof item.pattern === 'string' &&
      (item.scope === 'global' || item.scope === 'project');
  }

  isAllowed(action: ApprovalAction, resource: string, cwd: string, dangerous = false): boolean {
    // A persisted approval must never bypass the hard dangerous-command gate.
    if (dangerous) return false;
    const sessionPatterns = this.session.get(action) ?? new Set<string>();
    if (Array.from(sessionPatterns).some(pattern => matches(resource, pattern))) return true;

    return this.readPersistent().some(record => {
      if (record.action !== action || !matches(resource, record.pattern)) return false;
      if (record.scope === 'global') return true;
      return record.scope === 'project' && !!record.cwd && resolve(record.cwd) === resolve(cwd);
    });
  }

  grant(action: ApprovalAction, pattern: string, scope: ApprovalScope, cwd: string): void {
    const cleanPattern = normalize(pattern);
    if (!cleanPattern) return;
    if (scope === 'session') {
      const set = this.session.get(action) ?? new Set<string>();
      set.add(cleanPattern);
      this.session.set(action, set);
      return;
    }

    const records = this.readPersistent();
    const record: ApprovalRecord = {
      action,
      pattern: cleanPattern,
      scope,
      cwd: scope === 'project' ? resolve(cwd) : undefined,
      createdAt: new Date().toISOString(),
    };
    const duplicate = records.some(existing =>
      existing.action === record.action &&
      existing.pattern === record.pattern &&
      existing.scope === record.scope &&
      existing.cwd === record.cwd
    );
    if (!duplicate) records.push(record);
    this.records = records;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(records, null, 2) + '\n', 'utf8');
  }

  revokeAll(): void {
    this.session.clear();
    this.records = [];
    if (existsSync(this.file)) writeFileSync(this.file, '[]\n', 'utf8');
  }

  list(): ApprovalRecord[] {
    return this.readPersistent().map(record => ({ ...record }));
  }
}

export const approvalStore = new ApprovalStore();
