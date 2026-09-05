/**
 * SessionStore — persists conversations as JSON under ~/.mycode/sessions.
 * Powers /save, /resume, /sessions, `mycode --continue`, and session search.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../agent/context.js';

export interface SavedSession {
  id: string;
  title: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  usage?: Record<string, number>;
  messages: Message[];
}

export interface SessionSummary {
  id: string;
  title: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  messageCount: number;
  firstPrompt: string;
  file: string;
}

export class SessionStore {
  private _dir: string | undefined;

  constructor(dir?: string) {
    this._dir = dir;
  }

  private get dir(): string {
    if (!this._dir) this._dir = join(homedir() || process.env.HOME || '.', '.mycode', 'sessions');
    return this._dir;
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

  save(session: SavedSession): string {
    this.ensure();
    const file = this.fileFor(session.id);
    writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
    return file;
  }

  load(idOrTitle: string): SavedSession | null {
    const direct = this.fileFor(idOrTitle);
    if (existsSync(direct)) return this.read(direct);
    const q = idOrTitle.toLowerCase();
    if (q === 'latest' || q === 'last') {
      const [latest] = this.list();
      return latest ? this.read(latest.file) : null;
    }
    const all = this.list();
    const byTitle = all.find(s => s.title?.toLowerCase() === q) ?? all.find(s => s.id.toLowerCase().startsWith(q)) ?? all.find(s => s.title?.toLowerCase().includes(q));
    return byTitle ? this.read(byTitle.file) : null;
  }

  latestFor(cwd?: string): SavedSession | null {
    const all = this.list();
    const match = cwd ? all.find(s => s.cwd === cwd) : all[0];
    return match ? this.read(match.file) : null;
  }

  delete(id: string): boolean {
    const f = this.fileFor(id);
    if (!existsSync(f)) return false;
    unlinkSync(f);
    return true;
  }

  list(limit = 50): SessionSummary[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const out: SessionSummary[] = [];
    for (const f of files) {
      const full = join(this.dir, f);
      try {
        const s = this.read(full);
        if (!s) continue;
        const firstUser = s.messages.find(m => m.role === 'user');
        out.push({
          id: s.id,
          title: s.title,
          cwd: s.cwd,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt ?? statSync(full).mtime.toISOString(),
          model: s.model,
          messageCount: s.messages.length,
          firstPrompt: (firstUser?.content ?? '').replace(/\s+/g, ' ').slice(0, 100),
          file: full,
        });
      } catch {
        /* skip corrupt */
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out.slice(0, limit);
  }

  /** Simple full-text search across saved sessions. */
  search(query: string, limit = 10): Array<SessionSummary & { snippet: string }> {
    const q = query.toLowerCase();
    const res: Array<SessionSummary & { snippet: string }> = [];
    for (const s of this.list(500)) {
      const full = this.read(s.file);
      if (!full) continue;
      for (const m of full.messages) {
        if (m.role === 'system') continue;
        const idx = m.content.toLowerCase().indexOf(q);
        if (idx !== -1) {
          res.push({ ...s, snippet: m.content.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, ' ') });
          break;
        }
      }
      if (res.length >= limit) break;
    }
    return res;
  }

  private read(file: string): SavedSession | null {
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      if (!Array.isArray(data.messages)) return null;
      return data as SavedSession;
    } catch {
      return null;
    }
  }
}

export const sessionStore = new SessionStore();
