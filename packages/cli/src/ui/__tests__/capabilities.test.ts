import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { supportsCursorControl, supportsColour, resetCapabilityCache } from '../capabilities.js';

/** Save and clear the environment variables the detector reads. */
const KEYS = [
  'TERM',
  'TERM_PROGRAM',
  'WT_SESSION',
  'ConEmuANSI',
  'ANSICON',
  'MYCODE_NO_CURSOR',
  'MYCODE_PLAIN',
  'MYCODE_FORCE_CURSOR',
  'NO_COLOR',
  'FORCE_COLOR',
];

describe('supportsCursorControl', () => {
  let saved: Record<string, string | undefined> = {};
  const realPlatform = process.platform;
  const realIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  const setPlatform = (p: string) => {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  };
  const setTTY = (v: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true });
  };

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetCapabilityCache();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    if (realIsTTY) Object.defineProperty(process.stdout, 'isTTY', realIsTTY);
    resetCapabilityCache();
  });

  it('is false when stdout is not a TTY', () => {
    setTTY(false);
    setPlatform('linux');
    expect(supportsCursorControl()).toBe(false);
  });

  it('is true for an ordinary unix terminal', () => {
    setTTY(true);
    setPlatform('linux');
    process.env.TERM = 'xterm-256color';
    expect(supportsCursorControl()).toBe(true);
  });

  it('is false for a dumb terminal even on unix', () => {
    setTTY(true);
    setPlatform('linux');
    process.env.TERM = 'dumb';
    expect(supportsCursorControl()).toBe(false);
  });

  it('is false on a bare Windows console', () => {
    // The reported bug: cmd.exe and Windows PowerShell do not process the
    // erase/redraw sequences, so the status line was re-appended per keystroke.
    setTTY(true);
    setPlatform('win32');
    process.env.TERM = '';
    process.env.TERM_PROGRAM = '';
    expect(supportsCursorControl()).toBe(false);
  });

  it.each([
    ['Windows Terminal', { WT_SESSION: 'abc' }],
    ['ConEmu', { ConEmuANSI: 'ON' }],
    ['VS Code terminal', { TERM_PROGRAM: 'vscode' }],
    ['Git Bash / MSYS', { TERM: 'xterm-256color' }],
  ])('is true on Windows in %s', (_name, env) => {
    setTTY(true);
    setPlatform('win32');
    Object.assign(process.env, env);
    expect(supportsCursorControl()).toBe(true);
  });

  it('can be forced off', () => {
    setTTY(true);
    setPlatform('linux');
    process.env.MYCODE_NO_CURSOR = '1';
    expect(supportsCursorControl()).toBe(false);
  });

  it('can be forced on for an exotic but capable host', () => {
    setTTY(true);
    setPlatform('win32');
    process.env.MYCODE_FORCE_CURSOR = '1';
    expect(supportsCursorControl()).toBe(true);
  });

  it('caches the result until reset', () => {
    setTTY(true);
    setPlatform('linux');
    expect(supportsCursorControl()).toBe(true);
    process.env.TERM = 'dumb';
    expect(supportsCursorControl()).toBe(true); // still cached
    resetCapabilityCache();
    expect(supportsCursorControl()).toBe(false);
  });
});

describe('supportsColour', () => {
  afterEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  it('honours NO_COLOR', () => {
    process.env.NO_COLOR = '1';
    expect(supportsColour()).toBe(false);
  });

  it('honours FORCE_COLOR', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '3';
    expect(supportsColour()).toBe(true);
  });

  it('colour and cursor control are independent settings', () => {
    // A pipe can carry colour but has no cursor to move.
    process.env.FORCE_COLOR = '1';
    expect(supportsColour()).toBe(true);
  });
});
