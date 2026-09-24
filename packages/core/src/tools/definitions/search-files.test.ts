import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { searchFilesTool } from './search-files.js';

const run = (args: Record<string, unknown>, cwd: string) =>
  (searchFilesTool.execute as (a: Record<string, unknown>, c: string) => Promise<string>)(args, cwd);

describe('searchFilesTool', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-search-'));
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'junk'), { recursive: true });
    writeFileSync(join(dir, 'top.ts'), 'export const top_marker = 1;\n');
    writeFileSync(join(dir, 'src', 'app.ts'), 'export const needle_marker = 42;\n');
    writeFileSync(join(dir, 'src', 'deep', 'util.ts'), 'export const deep_marker = 7;\n');
    writeFileSync(join(dir, 'README.md'), '# readme\n');
    writeFileSync(join(dir, 'node_modules', 'junk', 'app.ts'), 'needle_marker\n');
  });

  describe('pattern mode', () => {
    // These are the cases the old hand-rolled matcher got wrong: it compared
    // the glob against the basename only, so anything with a path separator
    // matched nothing.
    it('matches recursive globs (**/*.ts)', async () => {
      const out = await run({ pattern: '**/*.ts' }, dir);
      expect(out).toContain('src/app.ts');
      expect(out).toContain('src/deep/util.ts');
      expect(out).toContain('top.ts');
    });

    it('matches path-prefixed globs (src/**/*.ts)', async () => {
      const out = await run({ pattern: 'src/**/*.ts' }, dir);
      expect(out).toContain('src/app.ts');
      expect(out).toContain('src/deep/util.ts');
      expect(out).not.toContain('top.ts');
    });

    it('matches single-level globs (src/*.ts)', async () => {
      const out = await run({ pattern: 'src/*.ts' }, dir);
      expect(out).toContain('src/app.ts');
      expect(out).not.toContain('src/deep/util.ts');
    });

    it('treats *.ts as top-level only, per real glob semantics', async () => {
      const out = await run({ pattern: '*.ts' }, dir);
      expect(out).toContain('top.ts');
      expect(out).not.toContain('src/app.ts');
    });

    it('supports brace expansion', async () => {
      const out = await run({ pattern: '**/*.{ts,md}' }, dir);
      expect(out).toContain('README.md');
      expect(out).toContain('src/app.ts');
    });

    it('excludes node_modules', async () => {
      const out = await run({ pattern: '**/*.ts' }, dir);
      expect(out).not.toContain('node_modules');
    });

    it('reports no matches clearly', async () => {
      const out = await run({ pattern: '**/*.rs' }, dir);
      expect(out).toBe('No matching files found.');
    });

    it('respects the include extension filter', async () => {
      const out = await run({ pattern: '**/*', include: '.md' }, dir);
      expect(out).toContain('README.md');
      expect(out).not.toContain('src/app.ts');
    });
  });

  describe('content mode', () => {
    it('greps file contents and reports line numbers', async () => {
      const out = await run({ content: 'needle_marker', path: '.' }, dir);
      expect(out).toContain('needle_marker');
      expect(out).toMatch(/src\/app\.ts:1:/);
    });

    it('is case-insensitive', async () => {
      const out = await run({ content: 'NEEDLE_MARKER' }, dir);
      expect(out).toContain('needle_marker');
    });

    it('does not descend into node_modules', async () => {
      const out = await run({ content: 'needle_marker' }, dir);
      expect(out).not.toContain('node_modules');
    });
  });
});
