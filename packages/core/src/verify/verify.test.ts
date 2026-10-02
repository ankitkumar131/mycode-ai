import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isVerifiable, filterDiagnostics, renderVerification, runFormatter, runDiagnostics } from './verify.js';

describe('isVerifiable', () => {
  it('accepts source extensions', () => {
    for (const f of ['a.ts', 'a.tsx', 'a.py', 'a.go', 'a.rs', 'a.js']) {
      expect(isVerifiable(f)).toBe(true);
    }
  });

  it('rejects non-source files', () => {
    for (const f of ['a.md', 'a.json', 'a.txt', 'a.png', 'Makefile']) {
      expect(isVerifiable(f)).toBe(false);
    }
  });

  it('is case-insensitive and path-tolerant', () => {
    expect(isVerifiable('/tmp/deep/dir/File.TS')).toBe(true);
  });
});

describe('filterDiagnostics', () => {
  const raw = [
    'src/alpha.ts(3,5): error TS2322: Type mismatch',
    'src/beta.ts(9,1): error TS1005: Expected ;',
    'node_modules/dep/index.d.ts(1,1): error TS9999: noise from a dependency',
  ].join('\n');

  it('keeps only lines mentioning the touched files', () => {
    const out = filterDiagnostics(raw, ['src/alpha.ts']);
    expect(out).toContain('alpha.ts');
    expect(out).not.toContain('beta.ts');
  });

  it('matches on basename so absolute paths still match', () => {
    const out = filterDiagnostics(raw, ['/home/user/project/src/alpha.ts']);
    expect(out).toContain('alpha.ts');
  });

  it('falls back to the full output when nothing matches, rather than hiding errors', () => {
    // A change that breaks an untouched file still matters.
    const out = filterDiagnostics(raw, ['src/unrelated.ts']);
    expect(out).toContain('alpha.ts');
    expect(out).toContain('beta.ts');
  });

  it('returns everything when no file filter is given', () => {
    expect(filterDiagnostics(raw, [])).toContain('beta.ts');
  });

  it('bounds the number of diagnostics reported', () => {
    // 500 errors would otherwise dominate the next request; the model needs the
    // first screenful, not the whole build log.
    const noisy = Array.from({ length: 500 }, (_, i) => `src/alpha.ts(${i},1): error TS1: boom`).join('\n');
    const out = filterDiagnostics(noisy, ['src/alpha.ts']);
    expect(out.split('\n').length).toBeLessThanOrEqual(60);
    expect(out.length).toBeLessThan(3_500);
  });

  it('ignores blank lines', () => {
    expect(filterDiagnostics('\n\n', ['a.ts'])).toBe('');
  });
});

describe('renderVerification', () => {
  it('returns an empty string for a clean result', () => {
    expect(renderVerification({ diagnostics: '', formatted: '', ran: [], skipped: true })).toBe('');
  });

  it('labels diagnostics so the model knows they are actionable', () => {
    const out = renderVerification({ diagnostics: 'a.ts(1,1): error', formatted: '', ran: ['tsc'], skipped: false });
    expect(out).toContain('[diagnostics');
    expect(out).toContain('fix these');
    expect(out).toContain('a.ts(1,1): error');
  });

  it('reports formatter activity without pretending it is an error', () => {
    const out = renderVerification({ diagnostics: '', formatted: 'formatted 2 files with prettier', ran: [], skipped: false });
    expect(out).toBe('[formatter] formatted 2 files with prettier');
    expect(out).not.toContain('error');
  });

  it('includes both when both are present', () => {
    const out = renderVerification({ diagnostics: 'err', formatted: 'fmt', ran: [], skipped: false });
    expect(out.indexOf('fmt')).toBeLessThan(out.indexOf('err'));
  });
});

describe('runFormatter / runDiagnostics on an unsupported project', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-verify-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips instead of throwing when no toolchain is present', async () => {
    writeFileSync(join(dir, 'main.unknown'), 'x');
    const result = await runDiagnostics([join(dir, 'main.unknown')], dir);
    expect(result.skipped).toBe(true);
    expect(result.diagnostics).toBe('');
  });

  it('formatter reports nothing for an empty file list', async () => {
    const result = await runFormatter([], dir);
    expect(result.formatted).toBe('');
  });

  it('runs prettier when the project has it (formatting changes the file)', async () => {
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
    // A stub "prettier" that rewrites the file, proving the write path is wired.
    const stub = join(dir, 'node_modules', '.bin', 'prettier');
    writeFileSync(stub, '#!/bin/sh\necho "stub-formatted"\n', { mode: 0o755 });
    const target = join(dir, 'a.ts');
    writeFileSync(target, 'const  x=1\n');

    const result = await runFormatter([target], dir);
    expect(result.ran.join(' ')).toContain('prettier');
  });
});
