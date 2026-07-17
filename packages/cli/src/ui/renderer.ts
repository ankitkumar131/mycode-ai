import { Marked, Token } from 'marked';
import chalk from 'chalk';

const BRAND = {
  heading: '#60A5FA',
  headingBold: '#93C5FD',
  text: '#E5E7EB',
  muted: '#9CA3AF',
  dim: '#6B7280',
  code: '#E5E7EB',
  codeBg: '#1F2937',
  codespan: '#F472B6',
  link: '#60A5FA',
  strong: '#FBBF24',
  blockquote: '#9CA3AF',
  success: '#34D399',
  error: '#EF4444',
  diffAdd: '#34D399',
  diffDel: '#EF4444',
  diffHunk: '#60A5FA',
};

const INDENT = '  ';

function renderInline(tokens: Token[]): string {
  return tokens.map(t => renderInlineToken(t)).join('');
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case 'text': {
      const t = token as any;
      return t.tokens && t.tokens.length > 0 ? renderInline(t.tokens) : t.text;
    }
    case 'strong': {
      const t = token as any;
      return chalk.bold(renderInline(t.tokens));
    }
    case 'em': {
      const t = token as any;
      return chalk.italic(renderInline(t.tokens));
    }
    case 'codespan': {
      const t = token as any;
      return chalk.hex(BRAND.codespan).bgHex(BRAND.codeBg)(t.text);
    }
    case 'link': {
      const t = token as any;
      return chalk.hex(BRAND.link).underline(renderInline(t.tokens));
    }
    case 'del': {
      const t = token as any;
      return chalk.strikethrough(renderInline(t.tokens));
    }
    case 'br':
      return '\n';
    case 'image': {
      const t = token as any;
      return chalk.dim(`[${t.text}]`);
    }
    case 'html': {
      const t = token as any;
      return t.text;
    }
    default:
      return '';
  }
}

function renderBlock(token: Token): string {
  switch (token.type) {
    case 'heading': {
      const t = token as any;
      const content = t.tokens ? renderInline(t.tokens) : t.text || '';
      const style = t.depth === 1 ? chalk.hex(BRAND.headingBold).bold : chalk.hex(BRAND.heading).bold;
      return `\n${style(content)}\n`;
    }

    case 'paragraph': {
      const t = token as any;
      const content = t.tokens ? renderInline(t.tokens) : t.text || '';
      return `${content}\n`;
    }

    case 'code': {
      const t = token as any;
      const label = t.lang ? ` ${t.lang} ` : ' code ';
      const header = chalk.dim.bgHex(BRAND.codeBg)(label);
      const body = chalk.hex(BRAND.code).bgHex('#111827')(t.text);
      return `${header}\n${body}\n`;
    }

    case 'list': {
      const t = token as any;
      const bullet = t.ordered ? (i: number) => `${t.start + i}.` : () => '\u2022';
      return t.items.map((item: any, i: number) => {
        const content = renderListItem(item);
        return `${INDENT}${bullet(i)} ${content}`;
      }).join('\n') + '\n';
    }

    case 'blockquote': {
      const t = token as any;
      const blocks = t.tokens.map((st: Token) => renderBlock(st));
      return blocks.join('\n').split('\n').map(l => {
        const trimmed = l.trim();
        return trimmed ? chalk.hex(BRAND.blockquote).italic(INDENT + trimmed) : l;
      }).join('\n') + '\n';
    }

    case 'hr':
      return chalk.dim('\u2500'.repeat(Math.min(process.stdout.columns || 80, 50))) + '\n';

    case 'space':
      return '';

    case 'table': {
      const t = token as any;
      const lines: string[] = [];
      const header = t.header.map((c: any) => renderTableCell(c)).join(' | ');
      if (header) {
        lines.push(header);
        lines.push(t.header.map(() => '---').join(' | '));
      }
      for (const row of t.rows) {
        lines.push(row.map((c: any) => renderTableCell(c)).join(' | '));
      }
      return lines.map(l => `${INDENT}${l}`).join('\n') + '\n';
    }

    default:
      return '';
  }
}

function renderListItem(item: any): string {
  if (!item.tokens || item.tokens.length === 0) return item.text || '';

  if (item.tokens.length === 1 && item.tokens[0].type === 'text') {
    const textToken = item.tokens[0];
    if (textToken.tokens && textToken.tokens.length > 0) {
      return renderInline(textToken.tokens);
    }
    return textToken.text || '';
  }

  return item.tokens.map((t: Token) => renderBlock(t)).join('\n').trim();
}

function renderTableCell(cell: any): string {
  if (cell.tokens && cell.tokens.length > 0) {
    return renderInline(cell.tokens);
  }
  return cell.text || '';
}

export function renderMarkdown(md: string): string {
  if (!md || !md.trim()) return '';
  const marked = new Marked();
  const tokens = marked.lexer(md);
  return tokens.map(t => renderBlock(t)).filter(Boolean).join('\n');
}

export function renderDiff(diffText: string): void {
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(`${INDENT}${chalk.hex(BRAND.diffAdd)(line)}`);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(`${INDENT}${chalk.hex(BRAND.diffDel)(line)}`);
    } else if (line.startsWith('@@')) {
      console.log(`${INDENT}${chalk.hex(BRAND.diffHunk)(line)}`);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      console.log(`${INDENT}${chalk.bold(line)}`);
    } else {
      console.log(`${INDENT}${chalk.hex(BRAND.dim)(line)}`);
    }
  }
}

export function renderBox(title: string, content: string, color = '#60A5FA'): void {
  const width = Math.min(process.stdout.columns || 80, 70);
  const border = chalk.hex(color);

  console.log(`${INDENT}${border('\u250C' + '\u2500'.repeat(width - 4) + '\u2510')}`);
  console.log(`${INDENT}${border('\u2502')} ${chalk.bold(title).padEnd(width - 5)} ${border('\u2502')}`);
  console.log(`${INDENT}${border('\u251C' + '\u2500'.repeat(width - 4) + '\u2524')}`);

  for (const line of content.split('\n')) {
    const trimmed = line.slice(0, width - 6);
    console.log(`${INDENT}${border('\u2502')} ${trimmed.padEnd(width - 5)} ${border('\u2502')}`);
  }

  console.log(`${INDENT}${border('\u2514' + '\u2500'.repeat(width - 4) + '\u2518')}`);
}

export function renderCodeBlock(code: string, language = '', filename = ''): void {
  const header = filename || language || 'code';
  console.log();
  console.log(`${INDENT}${chalk.dim.bgHex(BRAND.codeBg)(` ${header} `)}`);
  console.log(`${INDENT}${chalk.hex(BRAND.code).bgHex('#111827')(code)}`);
  console.log();
}
