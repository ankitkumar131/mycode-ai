import chalk from 'chalk';
import { getTokens, type ThemeTokens } from './registry.js';

/**
 * Live theme tokens.
 *
 * `theme` is a Proxy rather than a frozen object so that `/theme <name>` takes
 * effect immediately without every module re-importing. Existing call sites
 * (`theme.green`, `COLORS.diffAdd`) keep working unchanged — the legacy token
 * names are aliases onto the semantic tokens in themes/registry.ts.
 */

/** Legacy token name -> semantic token name. */
const ALIASES: Record<string, keyof ThemeTokens> = {
  green: 'brand',
  greenDim: 'brandDim',
  greenDeep: 'brandDeep',
  greenGlow: 'brandGlow',
  greenMute: 'brandMute',
  amber: 'accent',
  amberDim: 'accentDim',
  red: 'error',
  redMute: 'errorMute',
  white: 'text',
  muted: 'textMuted',
  dim: 'textDim',
  black: 'codeBgDark',
  brand: 'brand',
  brandLight: 'brandLight',
  brandDim: 'brandDim',
  accent: 'accent',
  accentPink: 'accentPink',
  accentCyan: 'brandGlow',
  accentGold: 'accentGold',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  text: 'text',
  textSecondary: 'textSecondary',
  textMuted: 'textMuted',
  textDim: 'textDim',
  sparkle: 'sparkle',
  thinking: 'thinking',
  tool: 'tool',
  provider: 'provider',
  switch: 'switch',
  codeBg: 'codeBg',
  codeBgDark: 'codeBgDark',
  diffAdd: 'diffAdd',
  diffDel: 'diffDel',
  diffHunk: 'diffHunk',
  border: 'border',
};

export const theme = new Proxy({} as Record<string, string>, {
  get: (_t, prop: string) => {
    const tokens = getTokens();
    const key = ALIASES[prop];
    if (key) return tokens[key];
    return (tokens as unknown as Record<string, string>)[prop];
  },
  has: (_t, prop: string) => prop in ALIASES || prop in getTokens(),
  ownKeys: () => Object.keys(ALIASES),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

export const COLORS = theme;

/** Chalk style helpers, resolved against the active theme on every access. */
export const S = new Proxy({} as Record<string, (s: string) => string>, {
  get: (_t, prop: string) => {
    const t = getTokens();
    switch (prop) {
      case 'brand':
        return chalk.hex(t.brand);
      case 'brandBold':
        return chalk.hex(t.brand).bold;
      case 'accent':
        return chalk.hex(t.accent);
      case 'accentBold':
        return chalk.hex(t.accent).bold;
      case 'cyan':
        return chalk.hex(t.brandGlow);
      case 'cyanBold':
        return chalk.hex(t.brandGlow).bold;
      case 'gold':
        return chalk.hex(t.accentGold);
      case 'success':
        return chalk.hex(t.success);
      case 'successBold':
        return chalk.hex(t.success).bold;
      case 'warning':
        return chalk.hex(t.warning);
      case 'warningBold':
        return chalk.hex(t.warning).bold;
      case 'error':
        return chalk.hex(t.error);
      case 'errorBold':
        return chalk.hex(t.error).bold;
      case 'text':
        return chalk.hex(t.text);
      case 'muted':
        return chalk.hex(t.textMuted);
      case 'dim':
        return chalk.hex(t.textDim);
      case 'dimmer':
        return chalk.hex(t.brandDim);
      case 'code':
        return (s: string) => chalk.hex(t.text).bgHex(t.codeBg)(s);
      case 'codespan':
        return (s: string) => chalk.hex(t.brandGlow).bgHex(t.codeBgDark)(s);
      default:
        return (s: string) => s;
    }
  },
});

export {
  getThemeName,
  setTheme,
  listThemes,
  themeNames,
  getTokens,
  DEFAULT_THEME,
} from './registry.js';
export type { ThemeTokens, Theme } from './registry.js';

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

export interface ToolMeta {
  icon: string;
  verb: string;
  color: string;
}

export const TOOL_ICONS: Record<string, ToolMeta> = {
  read_file: { icon: '📄', verb: 'Read', color: theme.greenGlow },
  read_document: { icon: '📑', verb: 'Read document', color: theme.amber },
  read_pdf: { icon: '📕', verb: 'Read PDF', color: theme.amber },
  write_file: { icon: '✏️', verb: 'Wrote', color: theme.amber },
  patch: { icon: '✏️', verb: 'Patched', color: theme.amber },
  list_dir: { icon: '📁', verb: 'Listed', color: theme.amber },
  search_files: { icon: '🔍', verb: 'Searched', color: theme.greenGlow },
  glob: { icon: '🔎', verb: 'Found files', color: theme.greenGlow },
  terminal: { icon: '⚡', verb: 'Ran', color: theme.muted },
  process: { icon: '⚙', verb: 'Process', color: theme.muted },
  execute_code: { icon: '🧪', verb: 'Executed code', color: theme.muted },
  git_status: { icon: '⎇', verb: 'Git status', color: theme.green },
  web_fetch: { icon: '🌐', verb: 'Fetched', color: theme.greenGlow },
  web_search: { icon: '🔭', verb: 'Searched web', color: theme.greenGlow },
  skills_list: { icon: '◆', verb: 'Listed skills', color: theme.amber },
  skill_view: { icon: '◆', verb: 'Viewed skill', color: theme.amber },
  skill_manage: { icon: '◆', verb: 'Skill', color: theme.amber },
  memory: { icon: '🧠', verb: 'Memory', color: theme.greenGlow },
  todo_write: { icon: '☑', verb: 'Todo', color: theme.green },
  read_instructions: { icon: '📘', verb: 'Read instructions', color: theme.green },
  delegate: { icon: '🤖', verb: 'Delegated', color: theme.amber },
};

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export function getWidth(max = 100): number {
  return Math.min(process.stdout.columns || 80, max);
}

export function heavyDivider(): string {
  const w = process.stdout.columns ?? 80;
  return chalk.hex(theme.greenDim)('━'.repeat(Math.min(w - 1, 80)));
}

export function sectionHeader(
  label: string,
  opts?: { accent?: 'amber' | 'green'; width?: number },
): string {
  const w = opts?.width ?? Math.min(process.stdout.columns ?? 80, 80);
  const accentColor = opts?.accent === 'amber' ? theme.amber : theme.green;
  const upper = label.toUpperCase();
  const tag = chalk.bgHex(accentColor).hex(theme.black).bold(` ${upper} `);
  const trail = chalk.hex(theme.greenDim)('─'.repeat(Math.max(0, w - upper.length - 4)));
  return `  ${tag} ${trail}`;
}

export function frame(
  content: string,
  opts?: {
    title?: string;
    borderColor?: string;
    width?: number;
    padding?: number;
    titleColor?: string;
  },
): string {
  const bc = opts?.borderColor ?? theme.green;
  const tc = opts?.titleColor ?? theme.green;
  const pad = opts?.padding ?? 1;
  const termW = process.stdout.columns ?? 80;
  const boxW = Math.max(20, Math.min(termW - 2, opts?.width ?? 76));
  const innerW = boxW - 4;

  let topBorder: string;
  if (opts?.title) {
    const titlePart = `┌─ ${chalk.hex(tc).bold(opts.title)} `;
    const titlePartVisible = stripAnsi(titlePart).length;
    const topFill = Math.max(0, boxW - titlePartVisible - 1);
    topBorder = chalk.hex(bc)(titlePart) + chalk.hex(bc)('─'.repeat(topFill)) + chalk.hex(bc)('┐');
  } else {
    topBorder = chalk.hex(bc)('┌' + '─'.repeat(boxW - 2) + '┐');
  }

  const bottomBorder = chalk.hex(bc)('└' + '─'.repeat(boxW - 2) + '┘');
  const contentLines = content.split('\n');
  const padded = [...Array(pad).fill(''), ...contentLines, ...Array(pad).fill('')];
  const framed = padded
    .map((line) => {
      const visible = stripAnsi(line).length;
      const padSpaces = Math.max(0, innerW - visible - 1);
      return `${chalk.hex(bc)('│')} ${line}${' '.repeat(padSpaces)}${chalk.hex(bc)('│')}`;
    })
    .join('\n');

  return [topBorder, framed, bottomBorder].join('\n');
}

export function chatStatusBar(opts: {
  mode: string;
  model: string;
  cumulativeTokens?: number;
  contextWindow?: number;
  elapsed?: number;
}): void {
  const w = process.stdout.columns ?? 80;
  const dim = (s: string) => chalk.hex(theme.greenDim)(s);
  const mid = ' ' + dim('·') + ' ';

  const tags: string[] = [];
  tags.push(chalk.bgHex(theme.green).hex(theme.black).bold(` ${opts.mode} `));
  tags.push(chalk.hex(theme.greenGlow)(opts.model));

  if (opts.cumulativeTokens !== undefined) {
    if (opts.contextWindow) {
      const pct = Math.min(100, Math.round((opts.cumulativeTokens / opts.contextWindow) * 100));
      tags.push(chalk.hex(theme.amber)(`${opts.cumulativeTokens} tokens (${pct}%)`));
    } else {
      tags.push(chalk.hex(theme.amber)(`${opts.cumulativeTokens} tokens`));
    }
  }

  if (opts.elapsed !== undefined) {
    const time = opts.elapsed < 1000 ? `${opts.elapsed}ms` : `${(opts.elapsed / 1000).toFixed(1)}s`;
    tags.push(chalk.hex(theme.greenGlow)(time));
  }

  const inner = tags.join(mid);
  const innerVisible = stripAnsi(inner).length;
  const fillLen = Math.max(1, w - innerVisible - 3);

  console.log(`${dim('┃')} ${inner} ${dim('─'.repeat(fillLen))}`);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function hr(width?: number): string {
  const w = width ?? Math.min(process.stdout.columns || 80, 80);
  return chalk.hex(theme.greenDim)('─'.repeat(w));
}

export function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? `${pad}${l}` : l))
    .join('\n');
}
