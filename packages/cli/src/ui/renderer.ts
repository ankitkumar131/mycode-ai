/**
 * Terminal Markdown Renderer — Premium Edition
 * Gemini CLI-inspired: clean rendering with syntax highlighting, diff colors,
 * table borders, and proper heading hierarchy.
 */

import { Marked, type Token } from 'marked';
import chalk from 'chalk';
import { COLORS, S, ICONS, getWidth, indent } from './themes/theme.js';

const INDENT = '  ';

// ── Inline Token Rendering ─────────────────────────────────────────────────

function renderInline(tokens: Token[]): string {
  return tokens.map(t => renderInlineToken(t)).join('');
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case 'text': {
      const t = token as any;
      return t.tokens?.length > 0 ? renderInline(t.tokens) : t.text;
    }
    case 'strong': {
      const t = token as any;
      return chalk.hex(COLORS.accentGold).bold(renderInline(t.tokens));
    }
    case 'em': {
      const t = token as any;
      return chalk.italic(renderInline(t.tokens));
    }
    case 'codespan': {
      const t = token as any;
      return S.codespan(` ${t.text} `);
    }
    case 'link': {
      const t = token as any;
      return chalk.hex(COLORS.info).underline(renderInline(t.tokens));
    }
    case 'del': {
      const t = token as any;
      return chalk.strikethrough.dim(renderInline(t.tokens));
    }
    case 'br':
      return '\n';
    case 'image': {
      const t = token as any;
      return S.dim(`[img: ${t.text}]`);
    }
    case 'html': {
      const t = token as any;
      return t.text;
    }
    default:
      return '';
  }
}

// ── Block Token Rendering ──────────────────────────────────────────────────

function renderBlock(token: Token): string {
  switch (token.type) {
    case 'heading': {
      const t = token as any;
      const content = t.tokens ? renderInline(t.tokens) : t.text || '';
      const depth: number = t.depth;

      // Different styles per heading level
      if (depth === 1) {
        return `\n${chalk.hex(COLORS.brandLight).bold.underline(content)}\n`;
      } else if (depth === 2) {
        return `\n${chalk.hex(COLORS.brandLight).bold(content)}\n`;
      } else if (depth === 3) {
        return `\n${chalk.hex(COLORS.accent).bold(content)}\n`;
      } else {
        return `\n${chalk.hex(COLORS.textSecondary).bold(content)}\n`;
      }
    }

    case 'paragraph': {
      const t = token as any;
      const content = t.tokens ? renderInline(t.tokens) : t.text || '';
      return `${content}\n`;
    }

    case 'code': {
      const t = token as any;
      const lang = t.lang || '';
      const label = lang ? ` ${lang} ` : ' code ';

      // Detect diff blocks
      if (lang === 'diff') {
        return renderDiffBlock(t.text);
      }

      const header = chalk.dim.bgHex(COLORS.codeBg)(label);
      const lines = t.text.split('\n');
      const numbered = lines.map((line: string, i: number) => {
        const num = chalk.hex(COLORS.textDim)(`${String(i + 1).padStart(3)} `);
        return `${num}${chalk.hex(COLORS.text)(line)}`;
      }).join('\n');

      return `${header}\n${numbered}\n`;
    }

    case 'list': {
      const t = token as any;
      const bullet = t.ordered
        ? (i: number) => chalk.hex(COLORS.accent)(`${t.start + i}.`)
        : () => chalk.hex(COLORS.accent)('•');

      return t.items.map((item: any, i: number) => {
        const content = renderListItem(item);
        return `${INDENT}${bullet(i)} ${content}`;
      }).join('\n') + '\n';
    }

    case 'blockquote': {
      const t = token as any;
      const blocks = t.tokens.map((st: Token) => renderBlock(st));
      const content = blocks.join('\n').split('\n');
      return content.map((line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        return `${chalk.hex(COLORS.accent)(ICONS.bar)} ${chalk.hex(COLORS.textSecondary).italic(trimmed)}`;
      }).join('\n') + '\n';
    }

    case 'hr':
      return chalk.hex(COLORS.textDim)(ICONS.dash.repeat(Math.min(process.stdout.columns || 80, 50))) + '\n';

    case 'space':
      return '';

    case 'table': {
      const t = token as any;
      return renderTable(t);
    }

    default:
      return '';
  }
}

// ── Table rendering with box chars ──────────────────────────────────────────

function renderTable(t: any): string {
  // Calculate column widths
  const cols = t.header.length;
  const widths: number[] = new Array(cols).fill(0);

  const headerTexts = t.header.map((c: any, i: number) => {
    const text = renderTableCell(c);
    const plain = text.replace(/\u001b\[.*?m/g, ''); // strip ANSI
    widths[i] = Math.max(widths[i], plain.length);
    return text;
  });

  const rowTexts = t.rows.map((row: any[]) =>
    row.map((c: any, i: number) => {
      const text = renderTableCell(c);
      const plain = text.replace(/\u001b\[.*?m/g, '');
      widths[i] = Math.max(widths[i], plain.length);
      return text;
    })
  );

  // Add padding
  widths.forEach((_, i) => { widths[i] += 2; });

  const border = chalk.hex(COLORS.textDim);
  const lines: string[] = [];

  // Header
  const headerLine = headerTexts.map((text: string, i: number) => {
    const plain = text.replace(/\u001b\[.*?m/g, '');
    return chalk.bold(text) + ' '.repeat(Math.max(0, widths[i] - plain.length));
  }).join(border(' │ '));
  lines.push(`${INDENT}${headerLine}`);

  // Separator
  lines.push(`${INDENT}${widths.map(w => border(ICONS.dash.repeat(w))).join(border('─┼─'))}`);

  // Rows
  for (const row of rowTexts) {
    const rowLine = row.map((text: string, i: number) => {
      const plain = text.replace(/\u001b\[.*?m/g, '');
      return text + ' '.repeat(Math.max(0, widths[i] - plain.length));
    }).join(border(' │ '));
    lines.push(`${INDENT}${rowLine}`);
  }

  return lines.join('\n') + '\n';
}

function renderTableCell(cell: any): string {
  if (cell.tokens?.length > 0) return renderInline(cell.tokens);
  return cell.text || '';
}

// ── List item rendering ─────────────────────────────────────────────────────

function renderListItem(item: any): string {
  if (!item.tokens?.length) return item.text || '';
  if (item.tokens.length === 1 && item.tokens[0].type === 'text') {
    const textToken = item.tokens[0];
    if (textToken.tokens?.length > 0) return renderInline(textToken.tokens);
    return textToken.text || '';
  }
  return item.tokens.map((t: Token) => renderBlock(t)).join('\n').trim();
}

// ── Diff rendering ──────────────────────────────────────────────────────────

function renderDiffBlock(text: string): string {
  const lines = text.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return chalk.hex(COLORS.diffAdd)(line);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return chalk.hex(COLORS.diffDel)(line);
    } else if (line.startsWith('@@')) {
      return chalk.hex(COLORS.diffHunk)(line);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      return chalk.bold(line);
    } else {
      return S.dim(line);
    }
  });
  return lines.join('\n') + '\n';
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render markdown text to a terminal-formatted string.
 */
export function renderMarkdown(md: string): string {
  if (!md?.trim()) return '';
  const marked = new Marked();
  const tokens = marked.lexer(md);
  return tokens.map(t => renderBlock(t)).filter(Boolean).join('\n');
}

/**
 * Render a diff with color coding to the terminal.
 */
export function renderDiff(diffText: string): void {
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(`${INDENT}${chalk.hex(COLORS.diffAdd)(line)}`);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(`${INDENT}${chalk.hex(COLORS.diffDel)(line)}`);
    } else if (line.startsWith('@@')) {
      console.log(`${INDENT}${chalk.hex(COLORS.diffHunk)(line)}`);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      console.log(`${INDENT}${chalk.bold(line)}`);
    } else {
      console.log(`${INDENT}${S.dim(line)}`);
    }
  }
}

/**
 * Render a code block with language header.
 */
export function renderCodeBlock(code: string, language = '', filename = ''): void {
  const header = filename || language || 'code';
  console.log();
  console.log(`${INDENT}${chalk.dim.bgHex(COLORS.codeBg)(` ${header} `)}`);
  console.log(`${INDENT}${chalk.hex(COLORS.text).bgHex(COLORS.codeBgDark)(code)}`);
  console.log();
}

/**
 * Render a boxed message with border.
 */
export function renderBox(title: string, content: string, color = COLORS.brandLight): void {
  const width = getWidth(70);
  const border = chalk.hex(color);

  console.log(`${INDENT}${border(ICONS.corner.topLeft + ICONS.dash.repeat(width - 4) + ICONS.corner.topRight)}`);
  console.log(`${INDENT}${border(ICONS.bar)} ${chalk.bold(title).padEnd(width - 5)} ${border(ICONS.bar)}`);
  console.log(`${INDENT}${border(ICONS.corner.midLeft + ICONS.dash.repeat(width - 4) + ICONS.corner.midRight)}`);

  for (const line of content.split('\n')) {
    const trimmed = line.slice(0, width - 6);
    console.log(`${INDENT}${border(ICONS.bar)} ${trimmed.padEnd(width - 5)} ${border(ICONS.bar)}`);
  }

  console.log(`${INDENT}${border(ICONS.corner.bottomLeft + ICONS.dash.repeat(width - 4) + ICONS.corner.bottomRight)}`);
}
