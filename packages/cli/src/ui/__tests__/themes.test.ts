import { describe, it, expect, afterEach } from 'vitest';
import { THEMES, DEFAULT_THEME, listThemes, themeNames, getTheme, getTokens, getThemeName, setTheme } from '../themes/registry.js';
import { theme as legacyTheme } from '../themes/theme.js';

afterEach(() => setTheme(DEFAULT_THEME));

describe('theme registry', () => {
  it('ships a meaningful set of themes', () => {
    expect(themeNames().length).toBeGreaterThanOrEqual(8);
    expect(themeNames()).toContain(DEFAULT_THEME);
  });

  it('every theme defines every token', () => {
    // A theme missing a token would render `undefined` in the middle of the UI.
    const reference = Object.keys(THEMES[DEFAULT_THEME].tokens).sort();
    for (const t of listThemes()) {
      expect(Object.keys(t.tokens).sort(), `theme ${t.name}`).toEqual(reference);
    }
  });

  it('every token is a usable colour string', () => {
    for (const t of listThemes()) {
      for (const [key, value] of Object.entries(t.tokens)) {
        if (key === 'light') continue;
        expect(typeof value, `${t.name}.${key}`).toBe('string');
        expect(value, `${t.name}.${key}`).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
      }
    }
  });

  it('marks light themes so the renderer can adapt', () => {
    expect(THEMES.light.tokens.light).toBe(true);
    expect(THEMES.cyber.tokens.light).toBe(false);
  });

  it('has distinct descriptions and names', () => {
    const descriptions = listThemes().map((t) => t.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const t of listThemes()) expect(t.name).toBe(t.name.toLowerCase());
  });

  it('setTheme switches the active tokens and reports success', () => {
    expect(setTheme('nord')).toBe(true);
    expect(getThemeName()).toBe('nord');
    expect(getTokens().brand).toBe(THEMES.nord.tokens.brand);
  });

  it('setTheme rejects an unknown name without changing the active theme', () => {
    setTheme('gruvbox');
    expect(setTheme('not-a-theme')).toBe(false);
    expect(getThemeName()).toBe('gruvbox');
  });

  it('is case-insensitive', () => {
    expect(setTheme('NORD')).toBe(true);
    expect(getThemeName()).toBe('nord');
  });

  it('getTheme falls back to the default', () => {
    expect(getTheme('nope').name).toBe(DEFAULT_THEME);
  });
});

describe('legacy theme proxy', () => {
  it('resolves legacy token names to semantic tokens', () => {
    // Existing call sites use theme.green / COLORS.diffAdd; those must keep
    // working now that the palette is swappable.
    setTheme('cyber');
    expect(legacyTheme.green).toBe(THEMES.cyber.tokens.brand);
    expect(legacyTheme.diffAdd).toBe(THEMES.cyber.tokens.diffAdd);
    expect(legacyTheme.amber).toBe(THEMES.cyber.tokens.accent);
  });

  it('reflects a theme change without re-importing', () => {
    setTheme('cyber');
    const before = legacyTheme.green;
    setTheme('tokyonight');
    expect(legacyTheme.green).not.toBe(before);
    expect(legacyTheme.green).toBe(THEMES.tokyonight.tokens.brand);
  });
});
