/**
 * The approval prompt is the one place a user reliably reads, so the
 * "stop asking me" answer has to be reachable from it — not only from a slash
 * command they would have to already know about.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { confirmCommand } from '../prompt.js';

const ENTER = { name: 'return', sequence: '\r' };
const DOWN = { name: 'down', sequence: '\x1b[B' };

describe('confirmCommand', () => {
  let writes: string[] = [];

  beforeEach(() => {
    writes = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    (process.stdin as any).isRaw = false;
    (process.stdin as any).setRawMode = () => {};
    process.stdin.resume = (() => process.stdin) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (process as any).env.MYCODE_TEST;
  });

  const output = () => writes.join('');

  const choose = async (downs: number, opts?: Parameters<typeof confirmCommand>[4]) => {
    const promise = confirmCommand('/tmp/x.ts', '/tmp', null, 'create new file', opts);
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < downs; i++) process.stdin.emit('keypress', '', DOWN);
    await new Promise((r) => setTimeout(r, 0));
    process.stdin.emit('keypress', '\r', ENTER);
    return promise;
  };

  it('offers the session-wide option when the caller supports it', async () => {
    const promise = confirmCommand('/tmp/x.ts', '/tmp', null, null, { onAllowAll: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    process.stdin.emit('keypress', '\r', ENTER);
    await promise;
    expect(output()).toContain('Always allow everything for this session');
  });

  it('omits it when the caller does not support it', async () => {
    const promise = confirmCommand('/tmp/x.ts', '/tmp', null, null);
    await new Promise((r) => setTimeout(r, 0));
    process.stdin.emit('keypress', '\r', ENTER);
    await promise;
    expect(output()).not.toContain('Always allow everything');
  });

  it('uses a scope-specific label when the caller supplies one', async () => {
    const promise = confirmCommand('/tmp/x.ts', '/tmp', null, null, {
      onAllowAll: () => {},
      allowAllLabel: 'Always allow all file writes for this session',
    });
    await new Promise((r) => setTimeout(r, 0));
    process.stdin.emit('keypress', '\r', ENTER);
    await promise;
    expect(output()).toContain('Always allow all file writes for this session');
  });

  it('selecting the session option allows the action and fires the callback', async () => {
    const onAllowAll = vi.fn();
    // default select is "yes"; two downs reach the session option
    const allowed = await choose(2, { onAllowAll });
    expect(allowed).toBe(true);
    expect(onAllowAll).toHaveBeenCalledTimes(1);
  });

  it('selecting "execute once" does not arm the session bypass', async () => {
    const onAllowAll = vi.fn();
    const allowed = await choose(0, { onAllowAll });
    expect(allowed).toBe(true);
    expect(onAllowAll).not.toHaveBeenCalled();
  });

  it('selecting "skip" denies without arming anything', async () => {
    const onAllowAll = vi.fn();
    const allowed = await choose(3, { onAllowAll });
    expect(allowed).toBe(false);
    expect(onAllowAll).not.toHaveBeenCalled();
  });

  it('auto-confirms when not attached to a terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const onAllowAll = vi.fn();
    await expect(confirmCommand('/tmp/x.ts', '/tmp', null, null, { onAllowAll })).resolves.toBe(
      true,
    );
    expect(onAllowAll).not.toHaveBeenCalled();
  });
});
