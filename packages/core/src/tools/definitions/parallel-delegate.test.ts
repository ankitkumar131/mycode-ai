import { describe, expect, it, vi } from 'vitest';
import { parallelDelegateTool } from './parallel-delegate.js';

describe('parallel_delegate tool', () => {
  it('passes validated independent tasks to the session runtime', async () => {
    const delegateParallel = vi.fn().mockResolvedValue({ status: 'completed', results: [] });
    const result = await parallelDelegateTool.execute({
      tasks: [
        { task: 'Inspect the API error handling.', agent: 'explore' },
        { task: 'Inspect the UI test coverage.' },
        { task: '' },
      ],
    }, '/tmp/project', { delegateParallel });
    expect(delegateParallel).toHaveBeenCalledWith([
      { task: 'Inspect the API error handling.', agent: 'explore' },
      { task: 'Inspect the UI test coverage.', agent: 'explore' },
    ]);
    expect(JSON.parse(result)).toMatchObject({ status: 'completed' });
  });

  it('reports an unavailable runtime instead of claiming work completed', async () => {
    const result = await parallelDelegateTool.execute({ tasks: [{ task: 'Inspect the repository.' }] }, '/tmp/project');
    expect(JSON.parse(result)).toMatchObject({ success: false, status: 'unavailable' });
  });
});
