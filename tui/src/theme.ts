/**
 * Theme tokens ported from `packages/cli/src/ui/themes/registry.ts` (`cyber` dark).
 * OpenTUI consumes hex via `fg`/`style` props instead of chalk.
 */

export interface TuiTheme {
  brand: string;
  brandDim: string;
  brandGlow: string;
  brandLight: string;
  accent: string;
  accentGold: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  codeBg: string;
  diffAdd: string;
  diffDel: string;
  diffHunk: string;
  tool: string;
  provider: string;
  border: string;
}

export const cyberDark: TuiTheme = {
  brand: '#00f0ff',
  brandDim: '#0369a1',
  brandGlow: '#38bdf8',
  brandLight: '#7dd3fc',
  accent: '#d946ef',
  accentGold: '#f59e0b',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ff0055',
  info: '#38bdf8',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textDim: '#475569',
  codeBg: '#0f172a',
  diffAdd: '#34d399',
  diffDel: '#f87171',
  diffHunk: '#60a5fa',
  tool: '#38bdf8',
  provider: '#f59e0b',
  border: '#475569',
};

export let activeTheme: TuiTheme = cyberDark;

export function setActiveTheme(t: TuiTheme): void {
  activeTheme = t;
}
