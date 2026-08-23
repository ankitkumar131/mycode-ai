/**
 * Tests for command-executor.js
 * Verifies real-time command execution, timeout handling,
 * exit codes, and working directory validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeCommand } from '../src/tools/command-executor.js';
import { platform } from 'os';

const isWindows = platform() === 'win32';

// ── Basic execution ─────────────────────────────────────────────────────────

describe('CommandExecutor — basic execution', () => {
  it('should execute a simple echo command', async () => {
    const cmd = isWindows ? 'echo hello world' : 'echo hello world';
    const result = await executeCommand(cmd, { stream: false });

    assert.equal(result.exitCode, 0);
    assert.equal(result.status, 'success');
    assert.ok(result.stdout.includes('hello world'), 'stdout should contain "hello world"');
    assert.ok(result.durationMs >= 0, 'durationMs should be non-negative');
    assert.equal(result.timedOut, false);
    assert.equal(result.killed, false);
  });

  it('should capture exit code for failing commands', async () => {
    const cmd = isWindows ? 'cmd /c exit 42' : 'exit 42';
    const result = await executeCommand(cmd, { stream: false });

    assert.equal(result.exitCode, 42);
    assert.equal(result.status, 'failed');
  });

  it('should capture stderr output', async () => {
    const cmd = isWindows
      ? 'echo error output 1>&2'
      : 'echo "error output" >&2';
    const result = await executeCommand(cmd, { stream: false });

    assert.ok(
      result.stderr.includes('error output'),
      'stderr should contain "error output"'
    );
  });
});

// ── Working directory ───────────────────────────────────────────────────────

describe('CommandExecutor — working directory', () => {
  it('should execute in the specified cwd', async () => {
    const cwd = isWindows ? 'C:\\' : '/';
    const cmd = isWindows ? 'cd' : 'pwd';
    const result = await executeCommand(cmd, { cwd, stream: false });

    assert.equal(result.exitCode, 0);
    // The output should reference the root path
    const normalizedOutput = result.stdout.trim().replace(/\\/g, '/');
    assert.ok(
      normalizedOutput === '/' || normalizedOutput === 'C:/' || result.stdout.includes('C:\\'),
      `Expected root directory, got: ${result.stdout.trim()}`
    );
  });

  it('should return an error for non-existent cwd', async () => {
    const result = await executeCommand('echo test', {
      cwd: '/this/path/does/not/exist/anywhere',
      stream: false,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'failed');
    assert.ok(result.output.includes('does not exist'));
  });
});

// ── Timeout handling ────────────────────────────────────────────────────────

describe('CommandExecutor — timeouts', () => {
  it('should timeout long-running commands', async () => {
    const cmd = isWindows ? 'ping -n 30 127.0.0.1' : 'sleep 30';
    const result = await executeCommand(cmd, {
      timeoutMs: 1000, // 1 second timeout
      stream: false,
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.status, 'timeout');
    assert.ok(result.output.includes('timed out'), 'Output should mention timeout');
  });

  it('should complete fast commands within timeout', async () => {
    const cmd = isWindows ? 'echo fast' : 'echo fast';
    const result = await executeCommand(cmd, {
      timeoutMs: 10_000,
      stream: false,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 0);
  });
});

// ── AbortSignal ─────────────────────────────────────────────────────────────

describe('CommandExecutor — abort signal', () => {
  it('should abort a running command when signal fires', async () => {
    const controller = new AbortController();
    const cmd = isWindows ? 'ping -n 30 127.0.0.1' : 'sleep 30';

    // Abort after 500ms
    setTimeout(() => controller.abort(), 500);

    const result = await executeCommand(cmd, {
      timeoutMs: 0, // No timeout
      stream: false,
      signal: controller.signal,
    });

    assert.equal(result.killed, true);
    assert.equal(result.status, 'killed');
  });
});

// ── Output truncation ───────────────────────────────────────────────────────

describe('CommandExecutor — output handling', () => {
  it('should include the command in the output', async () => {
    const cmd = 'echo "test output"';
    const result = await executeCommand(cmd, { stream: false });

    assert.ok(result.output.includes('$ echo'), 'Output should include the command');
  });

  it('should include success message for exit 0', async () => {
    const cmd = isWindows ? 'echo ok' : 'echo ok';
    const result = await executeCommand(cmd, { stream: false });

    assert.ok(
      result.output.includes('Completed successfully'),
      'Output should include success message'
    );
  });
});

// ── Command history integration ─────────────────────────────────────────────

describe('CommandHistory', () => {
  it('should track commands and provide formatted summary', async () => {
    const { CommandHistory } = await import('../src/tools/command-history.js');

    const history = new CommandHistory();
    assert.equal(history.count(), 0);
    assert.equal(history.getContextSummary(), null);

    history.add({
      command: 'echo hello',
      cwd: '/test',
      exitCode: 0,
      signal: null,
      durationMs: 50,
      status: 'success',
      output: 'hello',
    });

    assert.equal(history.count(), 1);

    history.add({
      command: 'npm test',
      cwd: '/test',
      exitCode: 1,
      signal: null,
      durationMs: 5000,
      status: 'failed',
      output: 'Test failed: assertion error',
    });

    assert.equal(history.count(), 2);

    // Formatted summary
    const summary = history.formatSummary();
    assert.ok(summary.includes('echo hello'));
    assert.ok(summary.includes('npm test'));
    assert.ok(summary.includes('2 commands'));

    // Context summary for AI
    const context = history.getContextSummary();
    assert.ok(context.includes('echo hello'));
    assert.ok(context.includes('npm test'));

    // Clear
    history.clear();
    assert.equal(history.count(), 0);
  });
});
