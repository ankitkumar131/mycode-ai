import { describe, expect, it, vi } from 'vitest';
import { TaskRouter } from './task-router.js';
import { runAutomaticPostflight, runAutomaticPreflight } from './automatic-orchestrator.js';

const signal = new AbortController().signal;

describe('automatic orchestration adapters', () => {
  const router = new TaskRouter();

  it('runs a configured decision gate during decision preflight', async () => {
    const decisionGate = { decide: vi.fn().mockResolvedValue({ success: true, status: 'completed', summary: 'route', answers: { execution_path: 'native' } }) };
    const plan = router.plan({ query: 'Classify this failure.', cwd: '/tmp/project' });
    const evidence = await runAutomaticPreflight(plan, { query: 'Classify this failure.', cwd: '/tmp/project' }, { decisionGate }, signal);
    expect(decisionGate.decide).toHaveBeenCalled();
    expect(evidence?.kind).toBe('decision');
    expect(evidence?.success).toBe(true);
  });

  it('runs a configured sandbox backend for explicit isolation', async () => {
    const sandboxBackend = { runTask: vi.fn().mockResolvedValue({ success: true, status: 'completed', summary: 'isolated' }) };
    const query = 'Run this untrusted code in an isolated sandbox.';
    const plan = router.plan({ query, cwd: '/tmp/project' });
    const evidence = await runAutomaticPreflight(plan, { query, cwd: '/tmp/project' }, { sandboxBackend }, signal);
    expect(sandboxBackend.runTask).toHaveBeenCalled();
    expect(evidence?.kind).toBe('sandbox');
  });

  it('runs browser verification after a browser plan when a URL is present', async () => {
    const browserVerifier = { verify: vi.fn().mockResolvedValue({ success: true, status: 'passed', summary: 'UI passed' }) };
    const query = 'Verify the login page at http://127.0.0.1:3000/login in the browser.';
    const plan = router.plan({ query, cwd: '/tmp/project' });
    const evidence = await runAutomaticPostflight(plan, { query, cwd: '/tmp/project' }, { browserVerifier }, signal);
    expect(browserVerifier.verify).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:3000/login' }), expect.anything());
    expect(evidence?.kind).toBe('browser');
    expect(evidence?.success).toBe(true);
  });
});
