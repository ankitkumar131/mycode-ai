/**
 * Centralized Theme System
 * All colors, icons, and styling tokens for the MyCode CLI.
 * Inspired by Gemini CLI's clean, premium dark-mode aesthetic.
 */

import chalk, { type ChalkInstance } from 'chalk';

// ── Brand Palette ──────────────────────────────────────────────────────────

export const COLORS = {
  // Primary brand
  brand: '#4A90FF',
  brandLight: '#60A5FA',
  brandDim: '#3B82F6',

  // Accents
  accent: '#A78BFA',
  accentPink: '#F472B6',
  accentCyan: '#38BDF8',
  accentGold: '#FBBF24',

  // Semantic
  success: '#34D399',
  warning: '#FBBF24',
  error: '#EF4444',
  info: '#60A5FA',

  // Text hierarchy
  text: '#E5E7EB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textDim: '#4B5563',

  // Backgrounds
  codeBg: '#1F2937',
  codeBgDark: '#111827',
  headerBg: '#0F172A',

  // Diff
  diffAdd: '#34D399',
  diffDel: '#EF4444',
  diffHunk: '#60A5FA',

  // Special
  sparkle: '#60A5FA',
  thinking: '#A78BFA',
  tool: '#38BDF8',
  provider: '#A78BFA',
  switch: '#FBBF24',
} as const;

// ── Styled chalk shortcuts ─────────────────────────────────────────────────

export const S = {
  brand: chalk.hex(COLORS.brand),
  brandBold: chalk.hex(COLORS.brand).bold,
  accent: chalk.hex(COLORS.accent),
  accentBold: chalk.hex(COLORS.accent).bold,
  cyan: chalk.hex(COLORS.accentCyan),
  cyanBold: chalk.hex(COLORS.accentCyan).bold,
  gold: chalk.hex(COLORS.accentGold),

  success: chalk.hex(COLORS.success),
  successBold: chalk.hex(COLORS.success).bold,
  warning: chalk.hex(COLORS.warning),
  warningBold: chalk.hex(COLORS.warning).bold,
  error: chalk.hex(COLORS.error),
  errorBold: chalk.hex(COLORS.error).bold,

  text: chalk.hex(COLORS.text),
  muted: chalk.hex(COLORS.textSecondary),
  dim: chalk.hex(COLORS.textMuted),
  dimmer: chalk.hex(COLORS.textDim),

  code: chalk.hex(COLORS.text).bgHex(COLORS.codeBg),
  codespan: chalk.hex(COLORS.accentPink).bgHex(COLORS.codeBg),
} as const;

// ── Icons ───────────────────────────────────────────────────────────────────

export const ICONS = {
  sparkle: '✦',
  sparkleAlt: '✧',
  diamond: '◆',
  hexFull: '⬢',
  hexEmpty: '⬡',
  check: '✔',
  cross: '✖',
  warning: '⚠',
  arrow: '→',
  arrowRight: '▸',
  switch: '↻',
  dot: '●',
  circle: '○',
  bar: '│',
  dash: '─',
  corner: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    midLeft: '├',
    midRight: '┤',
  },
} as const;

// ── Tool display metadata ──────────────────────────────────────────────────

export interface ToolMeta {
  icon: string;
  verb: string;
  color: string;
}

export const TOOL_ICONS: Record<string, ToolMeta> = {
  readFile: { icon: '📄', verb: 'Read', color: COLORS.brandLight },
  readPDF: { icon: '📕', verb: 'Read PDF', color: COLORS.accentPink },
  writeFile: { icon: '✏️', verb: 'Wrote', color: COLORS.accent },
  editFile: { icon: '✏️', verb: 'Edited', color: COLORS.accent },
  listDirectory: { icon: '📁', verb: 'Listed', color: COLORS.accentGold },
  searchFiles: { icon: '🔍', verb: 'Searched', color: COLORS.brandLight },
  globSearch: { icon: '🔎', verb: 'Found files', color: COLORS.brandLight },
  executeCommand: { icon: '⚡', verb: 'Ran', color: COLORS.textSecondary },
  gitStatus: { icon: '⎇', verb: 'Git status', color: COLORS.success },
  fetchWebPage: { icon: '🌐', verb: 'Fetched', color: COLORS.accentCyan },
};

// ── Spinner frames ─────────────────────────────────────────────────────────

export const SPINNER_FRAMES = {
  thinking: {
    interval: 120,
    frames: [
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.thinking)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.thinking)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.diamond)}`,
      `  ${chalk.hex(COLORS.sparkle)(ICONS.sparkle)}`,
    ],
  },
  tool: {
    interval: 100,
    frames: [
      `  ${chalk.hex(COLORS.accent)(ICONS.hexEmpty)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexFull)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexEmpty)}`,
      `  ${chalk.hex(COLORS.accent)(ICONS.hexFull)}`,
    ],
  },
  codegen: {
    interval: 100,
    frames: [
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkleAlt)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkle)}`,
      `  ${chalk.hex(COLORS.tool)(ICONS.sparkleAlt)}`,
    ],
  },
} as const;

// ── Utility functions ──────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Get terminal width capped at a reasonable max.
 */
export function getWidth(max = 100): number {
  return Math.min(process.stdout.columns || 80, max);
}

/**
 * Create a horizontal rule.
 */
export function hr(width?: number): string {
  const w = width ?? getWidth(60);
  return S.dim(ICONS.dash.repeat(w));
}

/**
 * Indent every line of text.
 */
export function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(l => l ? `${pad}${l}` : l).join('\n');
}
