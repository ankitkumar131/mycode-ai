import { describe, expect, it } from 'vitest';
import { TaskRouter, formatTaskPlanGuidance } from './task-router.js';

describe('TaskRouter', () => {
  const router = new TaskRouter();

  it('keeps ordinary questions on the native path', () => {
    const plan = router.plan({ query: 'Explain this function to me.', cwd: '/tmp/project' });
    expect(plan.mode).toBe('native');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.recommendedTools).toEqual(['native_tools']);
  });

  it('plans a fixer followed by a read-only browser verifier', () => {
    const plan = router.plan({
      query: 'Fix the login form and verify the browser flow works in Chrome.',
      cwd: '/tmp/project',
    });

    expect(plan.mode).toBe('fix-and-verify');
    expect(plan.tasks.map(task => task.id)).toEqual(['fixer', 'browser-verifier']);
    expect(plan.tasks[1].dependsOn).toEqual(['fixer']);
    expect(plan.tasks[1].readOnly).toBe(true);
    expect(plan.tasks[0].workspaceBoundary?.version).toBe('before-fixer');
    expect(plan.tasks[1].workspaceBoundary?.version).toBe('after-fixer');
    expect(plan.tasks[1].serverReadiness?.required).toBe(true);
    expect(plan.recommendedTools).toContain('browser_verify');
    expect(formatTaskPlanGuidance(plan)).toContain('Automatic execution plan');
  });

  it('routes typed classification requests to a decision gate', () => {
    const plan = router.plan({ query: 'Classify these failures by severity and confidence.', cwd: '/tmp/project' });
    expect(plan.mode).toBe('decision');
    expect(plan.tasks[0].kind).toBe('decision');
    expect(plan.recommendedTools).toContain('decision_gate');
  });

  it('captures an application URL for automatic browser postflight', () => {
    const plan = router.plan({ query: 'Check the UI at http://127.0.0.1:3000/login in the browser.', cwd: '/tmp/project' });
    expect(plan.mode).toBe('browser');
    expect(plan.tasks[0].metadata?.url).toBe('http://127.0.0.1:3000/login');
  });

  it('routes explicit isolation requests to a sandbox worker', () => {
    const plan = router.plan({ query: 'Run this untrusted script in an isolated sandbox.', cwd: '/tmp/project' });
    expect(plan.mode).toBe('sandbox');
    expect(plan.tasks[0].kind).toBe('sandbox-worker');
    expect(plan.recommendedTools).toContain('sandbox_task');
  });

  it('recognizes explicit parallel work without pretending to have run it', () => {
    const plan = router.plan({ query: 'Run several agents independently in parallel.', cwd: '/tmp/project' });
    expect(plan.mode).toBe('parallel');
    expect(plan.tasks[0].kind).toBe('native');
    expect(plan.reason).toContain('concurrently');
  });
});
