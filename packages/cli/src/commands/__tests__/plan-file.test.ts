/**
 * The host writes the plan file, not the model.
 *
 * In plan mode `write_file` is gone (see core `plan-mode.ts`), so `/plan <task>`
 * cannot ask the model to save anything. The slug is the only user-controlled
 * part of the path, so the traversal cases are the ones that matter.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { planFilePath, savePlan, slug } from '../plan-file.js';

const NOW = new Date('2026-10-08T09:30:00.000Z');

describe('slug', () => {
  it('keeps it readable and short', () => {
    expect(slug('Fix the login redirect loop in auth.ts')).toBe('fix-the-login-redirect-loop-in');
    expect(slug('Fix the login redirect loop in auth.ts', 5)).toBe('fix-the-login-redirect-loop');
  });

  it('never produces an empty name', () => {
    expect(slug('')).toBe('plan');
    expect(slug('!!!')).toBe('plan');
  });

  it('cannot traverse out of the plans directory', () => {
    expect(slug('../../etc/passwd')).toBe('etc-passwd');
    expect(slug('..')).toBe('plan');
    expect(slug('a/../../b')).not.toContain('..');
    expect(slug('/etc/shadow')).toBe('etc-shadow');
  });
});

describe('planFilePath', () => {
  it('is dated, slugged, and inside .mycode/plans', () => {
    const file = planFilePath('/repo', 'add retries to the uploader', NOW);
    expect(file).toBe('/repo/.mycode/plans/2026-10-08-add-retries-to-the-uploader.md');
  });
});

describe('savePlan', () => {
  it('creates the directory and writes the plan, reporting a relative path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mycode-plan-'));
    try {
      const rel = savePlan(dir, 'wire up plan mode', '# Plan\n\nSteps\n', NOW);
      expect(rel).toBe(relative(dir, planFilePath(dir, 'wire up plan mode', NOW)));
      expect(existsSync(join(dir, rel))).toBe(true);
      expect(readFileSync(join(dir, rel), 'utf-8')).toBe('# Plan\n\nSteps\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends a trailing newline exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mycode-plan-'));
    try {
      const rel = savePlan(dir, 'x', 'no newline', NOW);
      expect(readFileSync(join(dir, rel), 'utf-8')).toBe('no newline\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
