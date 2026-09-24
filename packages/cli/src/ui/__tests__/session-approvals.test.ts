import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setAllowAllCommands,
  isAllowAllCommands,
  clearSessionApprovals,
  listAlwaysAllowed,
  confirmCommand,
} from '../prompt.js';

/**
 * Session-scoped "allow all commands".
 *
 * The property that matters: the flag covers command execution only. A file
 * write (safety === null) must still reach the interactive picker. We assert
 * that by watching whether the prompt renders anything at all — the
 * short-circuit path returns before any output.
 */

const COMMAND_SAFETY = { level: 'normal' as const, reason: 'ok' };

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => {
    chunks.push(typeof c === 'string' ? c : String(c));
    return true;
  });
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    chunks.push(a.join(' ') + '\n');
  });
  return {
    text: () => chunks.join(''),
    restore: () => {
      spy.mockRestore();
      log.mockRestore();
    },
  };
}

describe('session command approvals', () => {
  beforeEach(() => clearSessionApprovals());
  afterEach(() => clearSessionApprovals());

  it('defaults to off', () => {
    expect(isAllowAllCommands()).toBe(false);
    expect(listAlwaysAllowed()).toEqual([]);
  });

  it('toggles on and off', () => {
    setAllowAllCommands(true);
    expect(isAllowAllCommands()).toBe(true);
    setAllowAllCommands(false);
    expect(isAllowAllCommands()).toBe(false);
  });

  it('clearSessionApprovals resets the flag', () => {
    setAllowAllCommands(true);
    clearSessionApprovals();
    expect(isAllowAllCommands()).toBe(false);
  });

  it('auto-approves a command without rendering a prompt', async () => {
    setAllowAllCommands(true);
    const cap = captureStdout();
    const ok = await confirmCommand('npm test', '/tmp', COMMAND_SAFETY, null);
    cap.restore();
    expect(ok).toBe(true);
    // Short-circuited: the picker never drew.
    expect(cap.text()).not.toContain('Execute command?');
  });

  it('still prompts for a file write when allow-all is on', async () => {
    setAllowAllCommands(true);
    const cap = captureStdout();
    // safety === null marks a write. Non-TTY picker returns the first choice
    // ("Yes") before drawing its title, so assert on the prompt header instead.
    const ok = await confirmCommand('src/app.ts', '/tmp', null, null);
    cap.restore();
    expect(ok).toBe(true);
    // The write prompt rendered — allow-all did not swallow it.
    expect(cap.text()).toContain('File write requested');
    expect(cap.text()).toContain('✍ src/app.ts');
  });

  it('short-circuits commands but not writes: commands render nothing at all', async () => {
    setAllowAllCommands(true);

    const cmd = captureStdout();
    await confirmCommand('npm test', '/tmp', COMMAND_SAFETY, null);
    cmd.restore();

    const write = captureStdout();
    await confirmCommand('src/app.ts', '/tmp', null, null);
    write.restore();

    // Command: returned before any output. Write: full prompt header drawn.
    expect(cmd.text()).toBe('');
    expect(write.text()).toContain('File write requested');
  });

  it('does not leak the allow-all flag into the per-command list', () => {
    setAllowAllCommands(true);
    expect(listAlwaysAllowed()).toEqual([]);
    setAllowAllCommands(false);
    expect(isAllowAllCommands()).toBe(false);
    expect(listAlwaysAllowed()).toEqual([]);
  });
});

// ─── The user-facing entry point: the /allow-all slash command ──────────────

import { handleSlashCommand } from '../../commands/slash-commands.js';

describe('/allow-all slash command', () => {
  beforeEach(() => clearSessionApprovals());

  const ctx = { ui: {}, config: { preferences: {} }, cwd: '/tmp' } as any;
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  };

  it('turns on and off explicitly', async () => {
    quiet();
    await handleSlashCommand('/allow-all on', ctx);
    expect(isAllowAllCommands()).toBe(true);
    await handleSlashCommand('/allow-all off', ctx);
    expect(isAllowAllCommands()).toBe(false);
  });

  it('toggles when given no argument', async () => {
    quiet();
    await handleSlashCommand('/allow-all', ctx);
    expect(isAllowAllCommands()).toBe(true);
    await handleSlashCommand('/allow-all', ctx);
    expect(isAllowAllCommands()).toBe(false);
  });

  it('clear resets both the flag and the per-command list', async () => {
    quiet();
    await handleSlashCommand('/allow-all on', ctx);
    await handleSlashCommand('/allow-all clear', ctx);
    expect(isAllowAllCommands()).toBe(false);
    expect(listAlwaysAllowed()).toEqual([]);
  });

  it('list is handled', async () => {
    quiet();
    await handleSlashCommand('/allow-all on', ctx);
    const r = await handleSlashCommand('/allow-all list', ctx);
    expect(r?.handled).toBe(true);
  });

  it('works through the /allowall alias', async () => {
    quiet();
    await handleSlashCommand('/allowall on', ctx);
    expect(isAllowAllCommands()).toBe(true);
  });

  it('leaves state untouched on an unrecognised argument', async () => {
    quiet();
    await handleSlashCommand('/allow-all on', ctx);
    await handleSlashCommand('/allow-all nonsense', ctx);
    expect(isAllowAllCommands()).toBe(true);
  });
});
