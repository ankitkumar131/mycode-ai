import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunLedger } from './run-ledger.js';

describe('RunLedger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mycode-runs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a run and its final status for recovery/audit', () => {
    const ledger = new RunLedger(dir);
    const id = ledger.start({ sessionId: 'session-1', cwd: dir, provider: 'test', agent: 'build' });
    expect(ledger.load(id)?.status).toBe('running');

    const finished = ledger.finish(id, { status: 'completed', turns: 2, toolCalls: 3 });
    expect(finished?.finishedAt).toBeDefined();
    expect(finished?.toolCalls).toBe(3);
    expect(ledger.list(10)[0]?.id).toBe(id);
  });
});
