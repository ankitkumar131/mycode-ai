import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SnapshotStore } from './snapshots.js';

describe('SnapshotStore', () => {
  let dir: string;
  let home: string;
  let store: SnapshotStore;
  const originalHome = process.env.MYCODE_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-project-'));
    home = mkdtempSync(join(tmpdir(), 'mycode-home-'));
    process.env.MYCODE_HOME = home;
    store = new SnapshotStore();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.MYCODE_HOME;
    else process.env.MYCODE_HOME = originalHome;
  });

  it('restores an overwritten file to its prior contents', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'original');

    store.capture('s1', file);
    writeFileSync(file, 'agent edit');

    expect(store.restoreAll('s1').restored).toContain(file);
    expect(readFileSync(file, 'utf-8')).toBe('original');
  });

  it('deletes a file the agent created from nothing', () => {
    const file = join(dir, 'new.ts');
    store.capture('s1', file); // does not exist yet
    writeFileSync(file, 'brand new');

    store.restoreAll('s1');
    expect(existsSync(file)).toBe(false);
  });

  it('keeps the first capture when a file is written repeatedly', () => {
    // /undo should return the file to how it was before the agent started, not
    // to an intermediate state that is itself agent output.
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'v1');
    store.capture('s1', file);
    writeFileSync(file, 'v2');
    store.capture('s1', file);
    writeFileSync(file, 'v3');

    expect(store.list('s1')).toHaveLength(1);
    store.restoreAll('s1');
    expect(readFileSync(file, 'utf-8')).toBe('v1');
  });

  it('restores several files in one pass', () => {
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'A');
    writeFileSync(b, 'B');
    store.capture('s1', a);
    store.capture('s1', b);
    writeFileSync(a, 'A2');
    writeFileSync(b, 'B2');

    const { restored } = store.restoreAll('s1');
    expect(restored).toHaveLength(2);
    expect(readFileSync(a, 'utf-8')).toBe('A');
    expect(readFileSync(b, 'utf-8')).toBe('B');
  });

  it('restores a deleted file', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'keep me');
    store.capture('s1', file);
    rmSync(file);

    store.restoreAll('s1');
    expect(readFileSync(file, 'utf-8')).toBe('keep me');
  });

  it('recreates missing parent directories on restore', () => {
    const nested = join(dir, 'deep', 'nested', 'a.ts');
    mkdirSync(join(dir, 'deep', 'nested'), { recursive: true });
    writeFileSync(nested, 'content');
    store.capture('s1', nested);
    rmSync(join(dir, 'deep'), { recursive: true, force: true });

    store.restoreAll('s1');
    expect(readFileSync(nested, 'utf-8')).toBe('content');
  });

  it('restores a single file on request', () => {
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'A');
    writeFileSync(b, 'B');
    store.capture('s1', a);
    store.capture('s1', b);
    writeFileSync(a, 'A2');
    writeFileSync(b, 'B2');

    expect(store.restoreOne('s1', a)).toBe(true);
    expect(readFileSync(a, 'utf-8')).toBe('A');
    expect(readFileSync(b, 'utf-8')).toBe('B2');
  });

  it('returns false for a file that was never captured', () => {
    expect(store.restoreOne('s1', join(dir, 'never.ts'))).toBe(false);
  });

  it('keeps sessions isolated from each other', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'one');
    store.capture('s1', file);
    writeFileSync(file, 'two');
    store.capture('s2', file);

    store.restoreAll('s1');
    expect(readFileSync(file, 'utf-8')).toBe('one');
    expect(store.list('s2')[0].hash).toBe(store.list('s2')[0].hash);
  });

  it('tolerates a missing or corrupt manifest', () => {
    expect(store.list('never-existed')).toEqual([]);
    const manifest = join(home, 'snapshots', 'broken', 'manifest.json');
    mkdirSync(join(home, 'snapshots', 'broken'), { recursive: true });
    writeFileSync(manifest, '{ not json');
    expect(store.list('broken')).toEqual([]);
  });

  it('never throws when the project path is unwritable', () => {
    // capture() is called on the write path; a snapshot failure must not stop
    // the write the user actually asked for.
    expect(() => store.capture('s1', '/nonexistent-root-xyz/nested/file.ts')).not.toThrow();
  });

  it('clear removes the session snapshots', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'x');
    store.capture('s1', file);
    expect(store.list('s1')).toHaveLength(1);
    store.clear('s1');
    expect(store.list('s1')).toEqual([]);
  });

  it('records metadata usable for reporting', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'hello world');
    const entry = store.capture('s1', file)!;
    expect(entry.existed).toBe(true);
    expect(entry.size).toBe(11);
    expect(entry.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.path).toBe(file);
  });

  it('de-duplicates identical blobs across files', () => {
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'same');
    writeFileSync(b, 'same');
    const ea = store.capture('s1', a)!;
    const eb = store.capture('s1', b)!;
    expect(ea.blob).toBe(eb.blob);
  });
});
