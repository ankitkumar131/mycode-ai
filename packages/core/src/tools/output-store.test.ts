import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { truncateToolOutput, readSpilledOutput } from './output-store.js';

describe('truncateToolOutput', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-output-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes short output through untouched', () => {
    const r = truncateToolOutput('hello world');
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('hello world');
    expect(r.spillPath).toBeUndefined();
  });

  it('keeps head and tail, and omits the middle', () => {
    const raw = 'A'.repeat(100) + 'MIDDLE' + 'Z'.repeat(100);
    const r = truncateToolOutput(raw, { maxChars: 50, headChars: 30, tailChars: 20, noSpill: true });
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('A'.repeat(30))).toBe(true);
    expect(r.text.endsWith('Z'.repeat(20))).toBe(true);
    expect(r.text).toContain('characters omitted from the middle');
    expect(r.originalChars).toBe(raw.length);
  });

  it('reports the exact number of omitted characters', () => {
    const raw = 'x'.repeat(1000);
    const r = truncateToolOutput(raw, { maxChars: 100, headChars: 60, tailChars: 40, noSpill: true });
    // 1000 - 60 - 40 = 900 removed
    expect(r.text).toContain('900 characters omitted');
  });

  it('clamps head/tail defaults to the maxChars budget', () => {
    // Regression: default head (24k) + tail (12k) against a small maxChars used
    // to yield a negative omission count and a result longer than the input.
    const raw = 'x'.repeat(1_000);
    const r = truncateToolOutput(raw, { maxChars: 100, noSpill: true });
    expect(r.originalChars).toBe(1_000);
    expect(r.text.length).toBeLessThan(raw.length);
    expect(r.text).not.toMatch(/-\d+ characters omitted/);
  });

  it('spills the full output to disk and points the model at it', () => {
    const raw = 'line\n'.repeat(5_000);
    const r = truncateToolOutput(raw, { maxChars: 200, headChars: 100, tailChars: 50, dir, label: 'bash' });
    expect(r.truncated).toBe(true);
    expect(r.spillPath).toMatch(/bash-[0-9a-f]{16}\.txt$/);
    expect(existsSync(r.spillPath!)).toBe(true);
    expect(readFileSync(r.spillPath!, 'utf-8')).toBe(raw);
    expect(r.text).toContain('read_file');
    expect(r.text).toContain(r.spillPath!);
  });

  it('degrades gracefully when the spill directory cannot be created', () => {
    // No ancestor exists, so ensureDir refuses rather than attempting a deep
    // recursive create that could block on a pathological path.
    const raw = 'y'.repeat(500);
    const r = truncateToolOutput(raw, { maxChars: 100, dir: '/nonexistent-root-xyz/deep/deeper', label: 'x' });
    expect(r.truncated).toBe(true);
    expect(r.spillPath).toBeUndefined();
    expect(r.text).toContain('characters omitted');
  });

  it('creates the tool-output directory under MYCODE_HOME when missing', () => {
    const raw = 'w'.repeat(500);
    const r = truncateToolOutput(raw, { maxChars: 100, dir: join(dir, '.mycode', 'tool-output'), label: 'mkdir' });
    expect(r.spillPath).toBeTruthy();
    expect(existsSync(r.spillPath!)).toBe(true);
  });

  it('is idempotent for the same content (same spill file)', () => {
    const raw = 'z'.repeat(600);
    const a = truncateToolOutput(raw, { maxChars: 100, dir, label: 'same' });
    const b = truncateToolOutput(raw, { maxChars: 100, dir, label: 'same' });
    expect(a.spillPath).toBe(b.spillPath);
  });

  it('readSpilledOutput respects the limit', () => {
    const raw = 'q'.repeat(1_000);
    const r = truncateToolOutput(raw, { maxChars: 100, dir, label: 'limit' });
    const read = readSpilledOutput(r.spillPath!, 50);
    expect(read.length).toBeLessThanOrEqual(60); // 50 + truncation notice
  });

  it('ignores a missing spill file path', () => {
    // readSpilledOutput is a thin wrapper; missing files throw, which callers
    // guard. Assert the throw so the contract is explicit.
    expect(() => readSpilledOutput(join(dir, 'nope.txt'))).toThrow();
  });
});
