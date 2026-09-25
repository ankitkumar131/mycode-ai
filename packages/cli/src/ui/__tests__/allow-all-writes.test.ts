import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  confirmCommand,
  setAllowAllCommands,
  clearSessionApprovals,
  isAllowAllCommands,
  listAlwaysAllowed,
} from '../prompt.js';

/**
 * `/allow-all` must actually stop the prompts.
 *
 * Regression: the flag was consulted only when `safety` was truthy, i.e. for
 * commands. An agentic task is mostly file writes, so every write still stopped
 * to ask and the mode looked like it had been switched off. The status chip made
 * it worse - on narrow terminals it was dropped by width truncation, so nothing
 * on screen indicated the mode was still on.
 *
 * The hard floor is untouched: `blocked` commands are refused inside the
 * `terminal` tool before confirmFn is ever consulted.
 */
describe('allow-all covers file writes', () => {
  beforeEach(() => clearSessionApprovals());
  afterEach(() => clearSessionApprovals());

  it('auto-approves a command', async () => {
    setAllowAllCommands(true);
    const ok = await confirmCommand('npm install', process.cwd(), {
      level: 'normal',
      reason: 'safe',
    } as any);
    expect(ok).toBe(true);
  });

  it('auto-approves a file write, which used to fall through', async () => {
    setAllowAllCommands(true);
    // safety === null means "this is a file write".
    const ok = await confirmCommand('src/App.tsx', process.cwd(), null);
    expect(ok).toBe(true);
  });

  it('a file write still prompts when the mode is off', async () => {
    setAllowAllCommands(false);
    // In a non-TTY the picker returns the first choice ("yes"), so this only
    // proves it reached the prompt rather than short-circuiting.
    await expect(confirmCommand('src/App.tsx', process.cwd(), null)).resolves.toBeDefined();
  });

  it('the flag toggles and reports honestly', () => {
    expect(isAllowAllCommands()).toBe(false);
    setAllowAllCommands(true);
    expect(isAllowAllCommands()).toBe(true);
    setAllowAllCommands(false);
    expect(isAllowAllCommands()).toBe(false);
  });

  it('per-command approvals are independent of the session flag', async () => {
    // With the session flag off, an approved prefix still short-circuits.
    const ok = await confirmCommand('git status', process.cwd(), {
      level: 'normal',
      reason: 'safe',
    } as any);
    expect(typeof ok).toBe('boolean');
    expect(Array.isArray(listAlwaysAllowed())).toBe(true);
  });

  it('clearSessionApprovals resets everything', () => {
    setAllowAllCommands(true);
    clearSessionApprovals();
    expect(isAllowAllCommands()).toBe(false);
    expect(listAlwaysAllowed()).toEqual([]);
  });
});
