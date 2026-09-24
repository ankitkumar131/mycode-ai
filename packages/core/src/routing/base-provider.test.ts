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
    // `priority` is deliberately absent: a provider has no knowledge of the
    // order it was configured in — only the router does. It used to be
    // hardcoded to 0 here, which made every consumer report priority 0.
    expect(p.toJSON()).toEqual({
      name: 'test-provider',
      model: 'test-model',
      status: 'active',
      successCount: 0,
      failureCount: 0,
      lastError: undefined,
    });
  });

  it('toJSON status comes from the cooldown, not a flag that is always true', () => {
    const p = new TestProvider();
    // A brand-new provider must read as active.
    expect(p.toJSON().status).toBe('active');
    // Parking it must flip the status even though nothing sets isAvailable.
    p.recordFailure(60_000, 'endpoint gone');
    expect(p.toJSON().status).toBe('error');
    expect(p.toJSON().lastError).toBe('endpoint gone');
    // And recovering must clear it.
    p.recordSuccess();
    expect(p.toJSON().status).toBe('active');
  });
});
