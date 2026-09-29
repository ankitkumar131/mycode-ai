import { describe, expect, it } from 'vitest';
import { AxCliSandboxBackend } from './sandbox-backend.js';

const commandArgs = ['-e', "console.log('completed')"];

describe('AxCliSandboxBackend', () => {
  it('submits, resumes, and watches through the configured AX CLI', async () => {
    const backend = new AxCliSandboxBackend({
      command: process.execPath,
      image: 'test/image:latest',
      applyArgs: commandArgs,
      resumeArgs: commandArgs,
      watchArgs: commandArgs,
    });
    const result = await backend.runTask({ goal: 'Run an isolated check.', cwd: process.cwd() });
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.taskName).toMatch(/^mycode-/);
  });

  it('refuses to submit without a container image', async () => {
    const backend = new AxCliSandboxBackend({ command: process.execPath });
    const result = await backend.runTask({ goal: 'Run this safely.', cwd: process.cwd() });
    expect(result.success).toBe(false);
    expect(result.status).toBe('blocked');
  });

  it('reports an unavailable backend explicitly', async () => {
    const backend = new AxCliSandboxBackend({ enabled: false });
    const result = await backend.runTask({ goal: 'Run this.', cwd: process.cwd() });
    expect(result.success).toBe(false);
    expect(result.status).toBe('unavailable');
  });
});
