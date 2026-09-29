import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalStore } from './approval-store.js';

describe('ApprovalStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-approvals-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps session approvals in memory and persists project approvals', () => {
    const file = join(dir, 'approvals.json');
    const store = new ApprovalStore(file);
    const cwd = join(dir, 'project');

    store.grant('run_command', 'npm test', 'session', cwd);
    expect(store.isAllowed('run_command', 'npm test -- --run', cwd)).toBe(true);

    store.grant('run_command', 'git status', 'project', cwd);
    expect(store.isAllowed('run_command', 'git status --short', cwd)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('project');

    const reloaded = new ApprovalStore(file);
    expect(reloaded.isAllowed('run_command', 'git status --short', cwd)).toBe(true);
    expect(reloaded.isAllowed('run_command', 'git status', join(dir, 'other'))).toBe(false);
  });

  it('never lets a persisted approval bypass a dangerous command', () => {
    const store = new ApprovalStore(join(dir, 'approvals.json'));
    const cwd = join(dir, 'project');
    store.grant('run_command', 'rm -rf ./build', 'global', cwd);
    expect(store.isAllowed('run_command', 'rm -rf ./build', cwd, true)).toBe(false);
  });
});
