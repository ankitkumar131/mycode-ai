import { describe, expect, it } from 'vitest';
import { ExternalBrowserVerifier } from './browser-verifier.js';

const bridgeScript = [
  "let s='';",
  "process.stdin.on('data', c => s += c);",
  "process.stdin.on('end', () => console.log(JSON.stringify({success:true,status:'passed',summary:'verified',pageText:'Dashboard ready'})));",
].join('');

describe('ExternalBrowserVerifier', () => {
  it('returns a structured result from a JSON bridge', async () => {
    const verifier = new ExternalBrowserVerifier({
      command: process.execPath,
      args: ['-e', bridgeScript],
    }, process.cwd());

    const result = await verifier.verify({ url: 'http://127.0.0.1:3000', goal: 'Check the dashboard' });
    expect(result.success).toBe(true);
    expect(result.status).toBe('passed');
    expect(result.summary).toBe('verified');
  });

  it('reports an unconfigured verifier without pretending it passed', async () => {
    const result = await new ExternalBrowserVerifier({ enabled: false }).verify({
      url: 'http://127.0.0.1:3000',
      goal: 'Check the dashboard',
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe('unavailable');
  });

  it('supports aborting a running bridge', async () => {
    const controller = new AbortController();
    const verifier = new ExternalBrowserVerifier({
      command: process.execPath,
      args: ['-e', "setTimeout(() => console.log(JSON.stringify({success:true,status:'passed'})), 3000)"],
      timeoutMs: 10_000,
    });
    const pending = verifier.verify({ url: 'http://127.0.0.1:3000', goal: 'Wait' }, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('timeout');
    expect(result.success).toBe(false);
  });
});
