import { describe, it, expect } from 'vitest';
import { isNewerVersion, getLocalPackageInfo } from './update-check.js';

describe('update-check utility', () => {
  it('correctly compares semver strings', () => {
    expect(isNewerVersion('1.0.5', '1.0.6')).toBe(true);
    expect(isNewerVersion('1.0.5', '1.1.0')).toBe(true);
    expect(isNewerVersion('1.0.5', '2.0.0')).toBe(true);
    expect(isNewerVersion('1.0.5', '1.0.5')).toBe(false);
    expect(isNewerVersion('1.0.6', '1.0.5')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  it('gets local package info with published package fallback', () => {
    const info = getLocalPackageInfo();
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('version');
    expect(info.name).toBe('@ankitkumar131/mycode-ai');
  });
});
