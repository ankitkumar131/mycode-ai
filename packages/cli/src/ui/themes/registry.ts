/**
 * Theme registry — MyCode shipped a single hard-coded neon palette, which
 * assumed a dark terminal and made bright cyan unreadable on light backgrounds.
 *
 * Tokens are semantic rather than positional: `diff.hunk`, not `blue`. That way
 * adding a UI element does not require touching every theme, and a light theme
 * can be correct rather than inverted.
 */

export interface ThemeTokens {
  /** Primary brand / headings. */
  brand: string;
  brandDim: string;
  brandDeep: string;
  brandGlow: string;
  brandMute: string;
  brandLight: string;

  /** Accent (secondary brand). */
  accent: string;
  accentDim: string;
  accentPink: string;
  accentGold: string;

  /** Status. */
  success: string;
  warning: string;
  error: string;
  errorMute: string;
  info: string;

  /** Foreground scale. */
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  /** Background colour used for code spans; must contrast with `text`. */
  codeBg: string;
  codeBgDark: string;

  /** Diff. */
  diffAdd: string;
  diffDel: string;
  diffHunk: string;

  /** Semantic UI roles. */
  sparkle: string;
  thinking: string;
  tool: string;
  provider: string;
  switch: string;
  border: string;

  /** Whether this theme targets a light terminal background. */
  light?: boolean;
}

export interface Theme {
  name: string;
  description: string;
  tokens: ThemeTokens;
}

const dark = (t: Omit<ThemeTokens, 'light'>): ThemeTokens => ({ ...t, light: false });
const light = (t: Omit<ThemeTokens, 'light'>): ThemeTokens => ({ ...t, light: true });

export const THEMES: Record<string, Theme> = {
  cyber: {
    name: 'cyber',
    description: 'Electric cyan and neon magenta on near-black (MyCode default)',
    tokens: dark({
      brand: '#00f0ff', brandDim: '#0369a1', brandDeep: '#082f49', brandGlow: '#38bdf8',
      brandMute: '#0284c7', brandLight: '#7dd3fc',
      accent: '#d946ef', accentDim: '#86198f', accentPink: '#f472b6', accentGold: '#f59e0b',
      success: '#10b981', warning: '#f59e0b', error: '#ff0055', errorMute: '#9f1239', info: '#38bdf8',
      text: '#f8fafc', textSecondary: '#94a3b8', textMuted: '#64748b', textDim: '#475569',
      codeBg: '#0f172a', codeBgDark: '#020617',
      diffAdd: '#34d399', diffDel: '#f87171', diffHunk: '#60a5fa',
      sparkle: '#00f0ff', thinking: '#d946ef', tool: '#38bdf8', provider: '#f59e0b',
      switch: '#00f0ff', border: '#1e293b',
    }),
  },
  dark: {
    name: 'dark',
    description: 'Neutral high-contrast dark, no colour cast',
    tokens: dark({
      brand: '#e5e7eb', brandDim: '#4b5563', brandDeep: '#1f2937', brandGlow: '#93c5fd',
      brandMute: '#6b7280', brandLight: '#f3f4f6',
      accent: '#a78bfa', accentDim: '#5b21b6', accentPink: '#f9a8d4', accentGold: '#fbbf24',
      success: '#4ade80', warning: '#fbbf24', error: '#f87171', errorMute: '#7f1d1d', info: '#60a5fa',
      text: '#f3f4f6', textSecondary: '#d1d5db', textMuted: '#9ca3af', textDim: '#6b7280',
      codeBg: '#111827', codeBgDark: '#030712',
      diffAdd: '#4ade80', diffDel: '#f87171', diffHunk: '#60a5fa',
      sparkle: '#e5e7eb', thinking: '#a78bfa', tool: '#60a5fa', provider: '#fbbf24',
      switch: '#93c5fd', border: '#374151',
    }),
  },
  light: {
    name: 'light',
    description: 'For light terminal backgrounds',
    tokens: light({
      brand: '#0f172a', brandDim: '#94a3b8', brandDeep: '#e2e8f0', brandGlow: '#1d4ed8',
      brandMute: '#475569', brandLight: '#334155',
      accent: '#7c3aed', accentDim: '#c4b5fd', accentPink: '#db2777', accentGold: '#b45309',
      success: '#15803d', warning: '#b45309', error: '#b91c1c', errorMute: '#fca5a5', info: '#1d4ed8',
      text: '#0f172a', textSecondary: '#334155', textMuted: '#64748b', textDim: '#94a3b8',
      codeBg: '#e2e8f0', codeBgDark: '#f1f5f9',
      diffAdd: '#15803d', diffDel: '#b91c1c', diffHunk: '#1d4ed8',
      sparkle: '#7c3aed', thinking: '#7c3aed', tool: '#1d4ed8', provider: '#b45309',
      switch: '#1d4ed8', border: '#cbd5e1',
    }),
  },
  github: {
    name: 'github',
    description: 'GitHub light palette',
    tokens: light({
      brand: '#0969da', brandDim: '#8c959f', brandDeep: '#ddf4ff', brandGlow: '#218bff',
      brandMute: '#54aeff', brandLight: '#0550ae',
      accent: '#8250df', accentDim: '#c297ff', accentPink: '#bf3989', accentGold: '#9a6700',
      success: '#1a7f37', warning: '#9a6700', error: '#cf222e', errorMute: '#ff8182', info: '#0969da',
      text: '#1f2328', textSecondary: '#424a53', textMuted: '#656d76', textDim: '#8c959f',
      codeBg: '#eff1f3', codeBgDark: '#f6f8fa',
      diffAdd: '#1a7f37', diffDel: '#cf222e', diffHunk: '#0969da',
      sparkle: '#8250df', thinking: '#8250df', tool: '#0969da', provider: '#9a6700',
      switch: '#0969da', border: '#d0d7de',
    }),
  },
  nord: {
    name: 'nord',
    description: 'Nord — cool arctic blues',
    tokens: dark({
      brand: '#88c0d0', brandDim: '#4c566a', brandDeep: '#2e3440', brandGlow: '#8fbcbb',
      brandMute: '#5e81ac', brandLight: '#a3be8c',
      accent: '#b48ead', accentDim: '#5e3f5a', accentPink: '#d08770', accentGold: '#ebcb8b',
      success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', errorMute: '#7a3b41', info: '#81a1c1',
      text: '#eceff4', textSecondary: '#d8dee9', textMuted: '#a0a8b8', textDim: '#7b8394',
      codeBg: '#2e3440', codeBgDark: '#242933',
      diffAdd: '#a3be8c', diffDel: '#bf616a', diffHunk: '#81a1c1',
      sparkle: '#88c0d0', thinking: '#b48ead', tool: '#81a1c1', provider: '#ebcb8b',
      switch: '#8fbcbb', border: '#3b4252',
    }),
  },
  catppuccin: {
    name: 'catppuccin',
    description: 'Catppuccin Mocha — warm pastels',
    tokens: dark({
      brand: '#89b4fa', brandDim: '#45475a', brandDeep: '#181825', brandGlow: '#89dceb',
      brandMute: '#74c7ec', brandLight: '#b4befe',
      accent: '#cba6f7', accentDim: '#6c4a8f', accentPink: '#f5c2e7', accentGold: '#f9e2af',
      success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8', errorMute: '#8c3a4e', info: '#89b4fa',
      text: '#cdd6f4', textSecondary: '#bac2de', textMuted: '#a6adc8', textDim: '#7f849c',
      codeBg: '#1e1e2e', codeBgDark: '#11111b',
      diffAdd: '#a6e3a1', diffDel: '#f38ba8', diffHunk: '#89b4fa',
      sparkle: '#cba6f7', thinking: '#cba6f7', tool: '#89b4fa', provider: '#f9e2af',
      switch: '#89dceb', border: '#313244',
    }),
  },
  gruvbox: {
    name: 'gruvbox',
    description: 'Gruvbox Dark — retro warm',
    tokens: dark({
      brand: '#fabd2f', brandDim: '#665c54', brandDeep: '#282828', brandGlow: '#8ec07c',
      brandMute: '#d79921', brandLight: '#fbf1c7',
      accent: '#d3869b', accentDim: '#8f5c6b', accentPink: '#fb4934', accentGold: '#fe8019',
      success: '#b8bb26', warning: '#fabd2f', error: '#fb4934', errorMute: '#9d2f26', info: '#83a598',
      text: '#ebdbb2', textSecondary: '#d5c4a1', textMuted: '#bdae93', textDim: '#928374',
      codeBg: '#32302f', codeBgDark: '#1d2021',
      diffAdd: '#b8bb26', diffDel: '#fb4934', diffHunk: '#83a598',
      sparkle: '#fabd2f', thinking: '#d3869b', tool: '#83a598', provider: '#fe8019',
      switch: '#8ec07c', border: '#3c3836',
    }),
  },
  tokyonight: {
    name: 'tokyonight',
    description: 'Tokyo Night — deep blue with vivid accents',
    tokens: dark({
      brand: '#7aa2f7', brandDim: '#414868', brandDeep: '#1a1b26', brandGlow: '#7dcfff',
      brandMute: '#3d59a1', brandLight: '#bb9af7',
      accent: '#bb9af7', accentDim: '#6a4fa0', accentPink: '#ff007c', accentGold: '#e0af68',
      success: '#9ece6a', warning: '#e0af68', error: '#f7768e', errorMute: '#8c3d4b', info: '#7aa2f7',
      text: '#c0caf5', textSecondary: '#a9b1d6', textMuted: '#737aa2', textDim: '#565f89',
      codeBg: '#1f2335', codeBgDark: '#16161e',
      diffAdd: '#9ece6a', diffDel: '#f7768e', diffHunk: '#7aa2f7',
      sparkle: '#bb9af7', thinking: '#bb9af7', tool: '#7aa2f7', provider: '#e0af68',
      switch: '#7dcfff', border: '#292e42',
    }),
  },
};

export const DEFAULT_THEME = 'cyber';

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

let activeName = DEFAULT_THEME;

export function getThemeName(): string {
  return activeName;
}

export function getTheme(name?: string): Theme {
  return THEMES[name ?? activeName] ?? THEMES[DEFAULT_THEME];
}

export function getTokens(name?: string): ThemeTokens {
  return getTheme(name).tokens;
}

/** Switch the active theme. Returns false for an unknown name. */
export function setTheme(name: string): boolean {
  const key = name.toLowerCase().trim();
  if (!THEMES[key]) return false;
  activeName = key;
  return true;
}

/** Best-effort detection of a light terminal background. */
export function prefersLightTheme(): boolean {
  const bg = process.env.COLORFGBG;
  if (bg) {
    const parts = bg.split(';');
    const last = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!Number.isNaN(last) && last >= 7) return true;
  }
  if (process.env.TERM_BACKGROUND === 'light') return true;
  if (process.env.MYCODE_THEME_LIGHT === '1') return true;
  return false;
}
