import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parsePonytailMode,
  resolvePonytailMode,
  readPonytailConfig,
  ponytailConfigPaths,
  isPonytailMode,
  getPonytailMode,
  setPonytailMode,
  resetPonytailMode,
  isPonytailOverridden,
  ponytailSection,
  currentPonytailSection,
  describePonytailMode,
  DEFAULT_PONYTAIL_MODE,
  PONYTAIL_MODES,
} from '../ponytail.js';

const clean = (env: NodeJS.ProcessEnv) => {
  const e = { ...env };
  delete e.PONYTAIL_DEFAULT_MODE;
  delete e.XDG_CONFIG_HOME;
  delete e.APPDATA;
  return e;
};

describe('parsePonytailMode', () => {
  it('parses the four levels', () => {
    expect(parsePonytailMode('lite')).toBe('lite');
    expect(parsePonytailMode('full')).toBe('full');
    expect(parsePonytailMode('ultra')).toBe('ultra');
    expect(parsePonytailMode('off')).toBe('off');
  });

  it('accepts the level as a /ponytail argument', () => {
    expect(parsePonytailMode('/ponytail ultra')).toBe('ultra');
    expect(parsePonytailMode('  /ponytail  LITE ')).toBe('lite');
  });

  it('accepts the words people actually type', () => {
    expect(parsePonytailMode('stop')).toBe('off');
    expect(parsePonytailMode('disable')).toBe('off');
    expect(parsePonytailMode('on')).toBe('full');
    expect(parsePonytailMode('max')).toBe('ultra');
    expect(parsePonytailMode('light')).toBe('lite');
  });

  it('returns null for empty input so callers can show status instead', () => {
    expect(parsePonytailMode('')).toBeNull();
    expect(parsePonytailMode('   ')).toBeNull();
  });

  it('refuses to guess at unknown input', () => {
    expect(parsePonytailMode('banana')).toBeNull();
  });

  it('isPonytailMode agrees with the mode list', () => {
    for (const m of PONYTAIL_MODES) expect(isPonytailMode(m)).toBe(true);
    expect(isPonytailMode('banana')).toBe(false);
  });
});

describe('mode resolution', () => {
  let home: string;
  const realHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ponytail-'));
    resetPonytailMode();
  });

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
    resetPonytailMode();
  });

  it('defaults to full when nothing is configured', () => {
    expect(DEFAULT_PONYTAIL_MODE).toBe('full');
    expect(resolvePonytailMode(clean({}))).toBe('full');
  });

  it('env var wins', () => {
    expect(resolvePonytailMode({ PONYTAIL_DEFAULT_MODE: 'ultra' })).toBe('ultra');
    expect(resolvePonytailMode({ PONYTAIL_DEFAULT_MODE: 'OFF' })).toBe('off');
    expect(resolvePonytailMode({ PONYTAIL_DEFAULT_MODE: 'off' })).toBe('off');
  });

  it('ignores an invalid env var rather than disabling the behaviour', () => {
    // A typo must not silently turn the rules off.
    expect(resolvePonytailMode({ PONYTAIL_DEFAULT_MODE: 'ulra' })).toBe('full');
    expect(resolvePonytailMode({ PONYTAIL_DEFAULT_MODE: '' })).toBe('full');
  });

  it('falls back to the config file', () => {
    const dir = join(home, '.config', 'ponytail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ defaultMode: 'lite' }));
    expect(readPonytailConfig({ HOME: home })).toBe('lite');
    expect(resolvePonytailMode({ HOME: home })).toBe('lite');
  });

  it('honours XDG_CONFIG_HOME', () => {
    const dir = join(home, 'xdg', 'ponytail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ defaultMode: 'ultra' }));
    expect(resolvePonytailMode({ XDG_CONFIG_HOME: join(home, 'xdg') })).toBe('ultra');
  });

  it('env beats the config file', () => {
    const dir = join(home, '.config', 'ponytail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ defaultMode: 'lite' }));
    expect(resolvePonytailMode({ HOME: home, PONYTAIL_DEFAULT_MODE: 'ultra' })).toBe('ultra');
  });

  it('survives a malformed config file', () => {
    const dir = join(home, '.config', 'ponytail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{ not json');
    expect(readPonytailConfig({ HOME: home })).toBeNull();
    expect(resolvePonytailMode({ HOME: home })).toBe('full');
  });

  it('ignores an unknown defaultMode value', () => {
    const dir = join(home, '.config', 'ponytail');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ defaultMode: 'turbo' }));
    expect(resolvePonytailMode({ HOME: home })).toBe('full');
  });

  it('a session override wins over env', () => {
    setPonytailMode('ultra');
    expect(getPonytailMode({ PONYTAIL_DEFAULT_MODE: 'lite' })).toBe('ultra');
    expect(isPonytailOverridden()).toBe(true);
    resetPonytailMode();
    expect(getPonytailMode({ PONYTAIL_DEFAULT_MODE: 'lite' })).toBe('lite');
    expect(isPonytailOverridden()).toBe(false);
  });

  it('reports the config paths it searches', () => {
    const posix = ponytailConfigPaths({ XDG_CONFIG_HOME: '/x' }, '/home/u');
    expect(posix).toContain(join('/x', 'ponytail', 'config.json'));
    expect(posix).toContain(join('/home/u', '.config', 'ponytail', 'config.json'));
  });
});

describe('the injected section', () => {
  beforeEach(() => resetPonytailMode());
  afterEach(() => resetPonytailMode());

  it('teaches the ladder in order', () => {
    const s = ponytailSection('full');
    const rungs = [
      '1. Does this need to exist at all?',
      '2. Does it already exist in this codebase?',
      '3. Does the standard library do it?',
      '4. Does a native platform feature cover it?',
      '5. Does an already-installed dependency solve it?',
      '6. Can it be one line?',
      '7. Only then: write the minimum code that works.',
    ];
    let last = -1;
    for (const rung of rungs) {
      const at = s.indexOf(rung);
      expect(at, `missing rung: ${rung}`).toBeGreaterThan(-1);
      expect(at, `rung out of order: ${rung}`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('carries the rules that matter', () => {
    const s = ponytailSection('full');
    expect(s).toMatch(/unrequested abstractions/i);
    expect(s).toMatch(/deletion over addition/i);
    expect(s).toMatch(/root cause, not symptom/i);
    expect(s).toMatch(/ponytail:/);
    expect(s).toMatch(/understanding/i);
  });

  it('keeps the things that must never be simplified away', () => {
    const s = ponytailSection('full');
    expect(s).toMatch(/input validation/i);
    expect(s).toMatch(/data loss/i);
    expect(s).toMatch(/security/i);
    expect(s).toMatch(/accessibility/i);
    expect(s).toMatch(/explicitly requested/i);
  });

  it('states the intensity, differently per level', () => {
    expect(ponytailSection('lite')).toMatch(/Intensity: lite/);
    expect(ponytailSection('full')).toMatch(/Intensity: full/);
    expect(ponytailSection('ultra')).toMatch(/Intensity: ultra/);
    expect(ponytailSection('ultra')).toMatch(/YAGNI extremist/);
    expect(ponytailSection('lite')).not.toMatch(/YAGNI extremist/);
  });

  it('asks for a runnable check on non-trivial logic', () => {
    expect(ponytailSection('full')).toMatch(/ONE runnable check/);
  });

  it('is null when the mode is off', () => {
    setPonytailMode('off');
    expect(currentPonytailSection({})).toBeNull();
  });

  it('names its source and licence when active', () => {
    const s = currentPonytailSection({});
    expect(s).toMatch(/github\.com\/DietrichGebert\/ponytail/);
    expect(s).toMatch(/MIT/);
  });

  it('reflects a session switch immediately', () => {
    setPonytailMode('lite');
    expect(currentPonytailSection({})).toMatch(/Intensity: lite/);
  });
});

describe('describePonytailMode', () => {
  beforeEach(() => resetPonytailMode());
  afterEach(() => resetPonytailMode());

  it('says off when off', () => {
    setPonytailMode('off');
    expect(describePonytailMode({})).toBe('ponytail: off');
  });

  it('distinguishes a session setting from the default', () => {
    expect(describePonytailMode({})).toBe('ponytail: full (default)');
    setPonytailMode('ultra');
    expect(describePonytailMode({})).toBe('ponytail: ultra (set this session)');
  });
});
