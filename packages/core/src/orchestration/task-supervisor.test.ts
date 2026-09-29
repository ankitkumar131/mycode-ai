import { describe, expect, it, vi } from 'vitest';
import { TaskSupervisor } from './task-supervisor.js';
import type { TaskPlan } from './types.js';

const plan: TaskPlan = {
  id: 'plan-test',
  mode: 'parallel',
  reason: 'test',
  confidence: 1,
  recommendedTools: [],
  createdAt: new Date().toISOString(),
  tasks: [
    { id: 'a', kind: 'native', title: 'A', prompt: 'A' },
    { id: 'b', kind: 'native', title: 'B', prompt: 'B' },
    { id: 'c', kind: 'custom', title: 'C', prompt: 'C', dependsOn: ['a', 'b'] },
  ],
};

describe('TaskSupervisor', () => {
  it('runs independent tasks concurrently and releases dependents afterward', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const supervisor = new TaskSupervisor({ maxConcurrency: 2 });

    const result = await supervisor.run(plan, '/tmp/project', async task => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(`start:${task.id}`);
      await new Promise(resolve => setTimeout(resolve, task.id === 'a' ? 20 : 5));
      running--;
      order.push(`finish:${task.id}`);
      return { status: 'completed', summary: `${task.id} done` };
    });

    expect(result.status).toBe('completed');
    expect(maxRunning).toBe(2);
    expect(order.indexOf('start:c')).toBeGreaterThan(order.indexOf('finish:a'));
    expect(order.indexOf('start:c')).toBeGreaterThan(order.indexOf('finish:b'));
    expect(result.results.map(item => item.status)).toEqual(['completed', 'completed', 'completed']);
  });

  it('blocks dependent tasks after a failure', async () => {
    const execute = vi.fn(async task => {
      if (task.id === 'a') return { status: 'failed' as const, summary: 'failed', error: 'boom' };
      return { status: 'completed' as const, summary: 'done' };
    });

    const result = await new TaskSupervisor({ maxConcurrency: 2 }).run(plan, '/tmp/project', execute);
    expect(result.status).toBe('partial');
    expect(result.results.find(item => item.taskId === 'c')?.status).toBe('blocked');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns an aborted run when its signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new TaskSupervisor().run(plan, '/tmp/project', async () => ({ status: 'completed', summary: 'never' }), controller.signal);
    expect(result.status).toBe('aborted');
    expect(result.results.every(item => item.status === 'cancelled')).toBe(true);
  });
});
