import { BaseProvider } from './base-provider.js';

class TestProvider extends BaseProvider {
  get name() { return 'test-provider'; }
  get model() { return 'test-model'; }
  get canRead() { return true; }
  get canWrite() { return true; }

  async chat() { return { content: '' }; }
  async *stream() { yield { type: 'text', content: '' }; }
}

describe('BaseProvider', () => {
  it('tracks success count', () => {
    const p = new TestProvider();
    expect(p.getHealth().successCount).toBe(0);
    p.recordSuccess();
    expect(p.getHealth().successCount).toBe(1);
    p.recordSuccess();
    expect(p.getHealth().successCount).toBe(2);
  });

  it('tracks failure count', () => {
    const p = new TestProvider();
    p.recordFailure();
    p.recordFailure();
    expect(p.getHealth().failureCount).toBe(2);
  });

  it('getHealth returns a copy', () => {
    const p = new TestProvider();
    const h = p.getHealth();
    h.successCount = 99;
    expect(p.getHealth().successCount).toBe(0);
  });

  it('toJSON returns expected shape', () => {
    const p = new TestProvider();
    expect(p.toJSON()).toEqual({
      name: 'test-provider',
      model: 'test-model',
      priority: 0,
      status: 'active',
    });
  });

  it('toJSON shows error status after failures', () => {
    const p = new TestProvider();
    (p as any)._health.isAvailable = false;
    expect(p.toJSON().status).toBe('error');
  });
});
