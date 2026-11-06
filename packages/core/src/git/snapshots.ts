/**
 * File snapshots — reversible writes.
 *
 * `/undo` could only remove the last exchange from the *conversation*; the files
 * the agent had already rewritten stayed changed. That is the wrong half to be
 * able to undo. This module keeps the pre-edit contents so an edit can actually
 * be rolled back.
 *
 * Snapshots are stored under `~/.mycode/snapshots/<session>/` as a manifest plus
 * one blob per touched file. It is deliberately not a git operation: the user's
 * repository may be in any state, may be a subdirectory, or may not be a
 * repository at all, and a snapshot must never touch their index or working tree
 * beyond the file being restored.
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  rmSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir, tmpdir } from 'os';

export interface SnapshotEntry {
  /** Absolute path of the file as it was written. */
  path: string;
  /** Blob filename inside the snapshot directory. */
  blob: string;
  /** Whether the file existed before the write. */
  existed: boolean;
  /** Byte size before the write (0 when the file was new). */
  size: number;
  /** sha1 of the prior contents, for integrity and de-duplication. */
  hash: string;
  at: number;
}

export interface SnapshotManifest {
  sessionId: string;
  entries: SnapshotEntry[];
}

export function snapshotsRoot(): string {
  const base = process.env.MYCODE_HOME || join(homedir() || tmpdir(), '.mycode');
  return join(base, 'snapshots');
}

function safeSessionDir(sessionId: string): string {
  return join(snapshotsRoot(), sessionId.replace(/[^A-Za-z0-9_-]/g, '_'));
}

export class SnapshotStore {
  private dirFor(sessionId: string): string {
    return safeSessionDir(sessionId);
  }

  private manifestPath(sessionId: string): string {
    return join(this.dirFor(sessionId), 'manifest.json');
  }

  /**
   * Record the current contents of `filePath` before it is overwritten.
   *
   * Called immediately before a write. If the same file is written repeatedly in
   * one session, the *earliest* state wins, so `/undo` restores the file as it
   * was before the agent started rather than to an intermediate state.
   */
  capture(sessionId: string, filePath: string): SnapshotEntry | null {
    try {
      const abs = resolve(filePath);
      const manifest = this.read(sessionId);
      if (manifest.entries.some((e) => e.path === abs)) return null; // already captured

      const dir = this.dirFor(sessionId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const existed = existsSync(abs);
      const prior = existed ? readFileSync(abs) : Buffer.alloc(0);
      const hash = createHash('sha1').update(prior).digest('hex');

      const entry: SnapshotEntry = {
        path: abs,
        blob: existsSync(join(dir, hash)) ? hash : hash,
        existed,
        size: prior.length,
        hash,
        at: Date.now(),
      };

      if (existed) writeFileSync(join(dir, entry.blob), prior);
      manifest.entries.push(entry);
      writeFileSync(this.manifestPath(sessionId), JSON.stringify(manifest, null, 2));
      return entry;
    } catch {
      // A snapshot failure must never block a write the user asked for.
      return null;
    }
  }

  read(sessionId: string): SnapshotManifest {
    try {
      const p = this.manifestPath(sessionId);
      if (!existsSync(p)) return { sessionId, entries: [] };
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as SnapshotManifest;
      return { sessionId, entries: parsed.entries ?? [] };
    } catch {
      return { sessionId, entries: [] };
    }
  }

  list(sessionId: string): SnapshotEntry[] {
    return this.read(sessionId).entries;
  }

  /** Restore every captured file. Returns what was restored and what failed. */
  restoreAll(sessionId: string): { restored: string[]; failed: string[] } {
    const manifest = this.read(sessionId);
    const restored: string[] = [];
    const failed: string[] = [];

    for (const entry of [...manifest.entries].reverse()) {
      try {
        if (entry.existed) {
          const blob = join(this.dirFor(sessionId), entry.blob);
          if (!existsSync(blob)) {
            failed.push(entry.path);
            continue;
          }
          const dir = dirname(entry.path);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(entry.path, readFileSync(blob));
          restored.push(entry.path);
        } else if (existsSync(entry.path)) {
          // The file did not exist before the agent created it.
          unlinkSync(entry.path);
          restored.push(entry.path);
        }
      } catch {
        failed.push(entry.path);
      }
    }

    return { restored, failed };
  }

  /** Restore a single file. */
  restoreOne(sessionId: string, filePath: string): boolean {
    const abs = resolve(filePath);
    const entry = this.read(sessionId).entries.find((e) => e.path === abs);
    if (!entry) return false;
    try {
      if (entry.existed) {
        const blob = join(this.dirFor(sessionId), entry.blob);
        if (!existsSync(blob)) return false;
        writeFileSync(abs, readFileSync(blob));
      } else if (existsSync(abs)) {
        unlinkSync(abs);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Forget a session's snapshots (after they have been applied or discarded). */
  clear(sessionId: string): void {
    try {
      const dir = this.dirFor(sessionId);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  /** Remove snapshot directories older than `maxAgeMs`. */
  prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    const root = snapshotsRoot();
    if (!existsSync(root)) return 0;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    try {
      for (const name of readdirSync(root)) {
        const dir = join(root, name);
        try {
          if (statSync(dir).mtimeMs < cutoff) {
            rmSync(dir, { recursive: true, force: true });
            removed++;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return removed;
  }
}

export const snapshotStore = new SnapshotStore();
