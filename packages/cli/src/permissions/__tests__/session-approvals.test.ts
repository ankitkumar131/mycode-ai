import { describe, it, expect } from 'vitest';
import { SessionApprovals, parseAllowAllArgs, shouldPrompt } from '../session-approvals.js';

/** A clock the tests control, so "how long has this been on" is deterministic. */
function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('SessionApprovals', () => {
  it('asks by default', () => {
    const a = new SessionApprovals();
    expect(a.isOff).toBe(true);
    expect(a.isAllowed('writes')).toBe(false);
    expect(a.isAllowed('commands')).toBe(false);
    expect(a.badge()).toBeNull();
  });

  it('allowAll bypasses both categories', () => {
    const a = new SessionApprovals();
    a.allowAll();
    expect(a.isEverything).toBe(true);
    expect(a.isAllowed('writes')).toBe(true);
    expect(a.isAllowed('commands')).toBe(true);
    expect(a.badge()).toBe('ALLOW-ALL');
  });

  it('can bypass only file writes, which is the common case', () => {
    const a = new SessionApprovals();
    a.allow('writes');
    expect(a.isAllowed('writes')).toBe(true);
    expect(a.isAllowed('commands')).toBe(false);
    expect(a.isEverything).toBe(false);
    expect(a.badge()).toBe('ALLOW-ALL:writes');
  });

  it('can bypass only shell commands', () => {
    const a = new SessionApprovals();
    a.allow('commands');
    expect(a.isAllowed('commands')).toBe(true);
    expect(a.isAllowed('writes')).toBe(false);
    expect(a.badge()).toBe('ALLOW-ALL:commands');
  });

  it('revoke turns everything back on', () => {
    const a = new SessionApprovals();
    a.allowAll();
    a.revoke();
    expect(a.isOff).toBe(true);
    expect(a.badge()).toBeNull();
    expect(a.status().activeForMs).toBeNull();
  });

  it('reports how long the bypass has been armed', () => {
    const clock = makeClock();
    const a = new SessionApprovals(clock.now);
    a.allowAll();
    clock.advance(90_000);
    expect(a.status().activeForMs).toBe(90_000);
  });

  it('keeps the original arming time when a second scope is added', () => {
    const clock = makeClock();
    const a = new SessionApprovals(clock.now);
    a.allow('writes');
    clock.advance(30_000);
    a.allow('commands');
    clock.advance(10_000);
    expect(a.status().activeForMs).toBe(40_000);
  });

  it('describe() says it is session-only and names the blocked floor', () => {
    const a = new SessionApprovals();
    a.allowAll();
    const lines = a.describe().join(' ');
    expect(lines).toMatch(/this session only/i);
    expect(lines).toMatch(/settings/i);
    expect(lines).toMatch(/blocked/i);
  });

  it('describe() explains the partial case accurately', () => {
    const a = new SessionApprovals();
    a.allow('writes');
    expect(a.describe()[0]).toBe(
      'Approval prompts are off for file writes, for this session only.',
    );
  });

  it('describe() reports the normal state when nothing is bypassed', () => {
    expect(new SessionApprovals().describe()[0]).toMatch(/Approvals are on/);
  });
});

describe('parseAllowAllArgs', () => {
  it('treats an empty argument as everything', () => {
    for (const input of ['', '  ', 'all', 'on', 'everything', 'ALL']) {
      expect(parseAllowAllArgs(input)).toEqual({ action: 'on' });
    }
  });

  it('parses the scope names and their common synonyms', () => {
    for (const input of ['writes', 'write', 'edits', 'files']) {
      expect(parseAllowAllArgs(input)).toEqual({ action: 'on', scope: 'writes' });
    }
    for (const input of ['commands', 'command', 'shell', 'exec']) {
      expect(parseAllowAllArgs(input)).toEqual({ action: 'on', scope: 'commands' });
    }
  });

  it('parses off', () => {
    for (const input of ['off', 'revoke', 'reset', 'none', 'OFF']) {
      expect(parseAllowAllArgs(input)).toEqual({ action: 'off' });
    }
  });

  it('parses status', () => {
    expect(parseAllowAllArgs('status')).toEqual({ action: 'status' });
    expect(parseAllowAllArgs('show')).toEqual({ action: 'status' });
  });

  it('refuses to guess at unknown input', () => {
    expect(parseAllowAllArgs('banana')).toEqual({ action: 'invalid', input: 'banana' });
  });
});

describe('shouldPrompt', () => {
  const base = { yolo: false, isCommand: false, confirmCommands: true, confirmWrites: true };

  it('asks when nothing is bypassed and both preferences want confirmation', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, base)).toBe(true);
    expect(shouldPrompt(a, { ...base, isCommand: true })).toBe(true);
  });

  it('never asks under --yolo', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, { ...base, yolo: true })).toBe(false);
    expect(shouldPrompt(a, { ...base, yolo: true, isCommand: true })).toBe(false);
  });

  it('never asks for either category once /allow-all is on', () => {
    const a = new SessionApprovals();
    a.allowAll();
    expect(shouldPrompt(a, base)).toBe(false);
    expect(shouldPrompt(a, { ...base, isCommand: true })).toBe(false);
  });

  it('always asks for shell commands in plan mode, even with /allow-all armed', () => {
    const a = new SessionApprovals();
    a.allowAll();
    // Entering plan mode is an explicit narrowing, so it outranks a bypass the
    // user granted for ordinary work. `terminal` is the one tool plan mode
    // keeps (opencode keeps bash too), so this ask is the only thing standing
    // between a "planning" turn and `echo x > file`.
    expect(shouldPrompt(a, { ...base, isCommand: true, planMode: true })).toBe(true);
    expect(
      shouldPrompt(a, { ...base, isCommand: true, planMode: true, confirmCommands: false }),
    ).toBe(true);
  });

  it('lets --yolo still win in plan mode', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, { ...base, yolo: true, planMode: true, isCommand: true })).toBe(false);
  });

  it('leaves the write preference alone in plan mode (writes are removed upstream)', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, { ...base, planMode: true, confirmWrites: false })).toBe(false);
  });

  it('bypasses only the scope that was allowed', () => {
    const writes = new SessionApprovals();
    writes.allow('writes');
    expect(shouldPrompt(writes, base)).toBe(false); // write: no prompt
    expect(shouldPrompt(writes, { ...base, isCommand: true })).toBe(true); // command: still prompts

    const commands = new SessionApprovals();
    commands.allow('commands');
    expect(shouldPrompt(commands, base)).toBe(true);
    expect(shouldPrompt(commands, { ...base, isCommand: true })).toBe(false);
  });

  it('still asks after /allow-all off', () => {
    const a = new SessionApprovals();
    a.allowAll();
    a.revoke();
    expect(shouldPrompt(a, base)).toBe(true);
    expect(shouldPrompt(a, { ...base, isCommand: true })).toBe(true);
  });

  it('respects a preference that already disabled confirmation', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, { ...base, confirmWrites: false })).toBe(false);
    expect(shouldPrompt(a, { ...base, isCommand: true, confirmCommands: false })).toBe(false);
  });

  it('does not let the write preference silence a command prompt', () => {
    const a = new SessionApprovals();
    expect(shouldPrompt(a, { ...base, confirmWrites: false, isCommand: true })).toBe(true);
  });

  it('does not let a command bypass silence a write prompt', () => {
    const a = new SessionApprovals();
    a.allow('commands');
    expect(shouldPrompt(a, { ...base, yolo: false })).toBe(true);
  });
});
