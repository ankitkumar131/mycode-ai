import { describe, expect, it } from 'vitest';
import { ExternalDecisionGate } from './decision-gate.js';

const bridgeScript = [
  "let s='';",
  "process.stdin.on('data', c => s += c);",
  "process.stdin.on('end', () => console.log(JSON.stringify({success:true,answers:{route:{choice:'browser',confidence:0.95}},routing:{model:'test'}})));",
].join('');

describe('ExternalDecisionGate', () => {
  it('returns typed decisions from a JSON bridge', async () => {
    const gate = new ExternalDecisionGate({ command: process.execPath, args: ['-e', bridgeScript] });
    const result = await gate.decide({
      state: 'The login button is broken.',
      questions: { route: { type: 'choice', instructions: 'Which worker should handle this?', criteria: { browser: 'UI', code: 'backend' } } },
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.answers?.route).toEqual({ choice: 'browser', confidence: 0.95 });
  });

  it('reports unavailable when no bridge is configured', async () => {
    const result = await new ExternalDecisionGate({ enabled: false }).decide({ state: 'x', questions: {} });
    expect(result.success).toBe(false);
    expect(result.status).toBe('unavailable');
  });
});
