import { describe, expect, test } from 'bun:test';
import { runLive } from './pty.js';

describe('runLive', () => {
  test('streams command output and exits 0', async () => {
    const chunks: string[] = [];
    const cmd =
      process.platform === 'win32' ? 'echo hello-opentui' : 'echo hello-opentui';
    const result = await runLive({
      command: cmd,
      cwd: process.cwd(),
      timeoutMs: 15000,
      onData: (c) => chunks.push(c),
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('hello-opentui');
    expect(chunks.join('')).toContain('hello-opentui');
  }, 20000);

  test('nonzero exit propagates', async () => {
    const cmd = process.platform === 'win32' ? 'exit 3' : 'exit 3';
    const result = await runLive({
      command: cmd,
      cwd: process.cwd(),
      timeoutMs: 15000,
      onData: () => {},
    });
    expect(result.exitCode).not.toBe(0);
  }, 20000);
});
