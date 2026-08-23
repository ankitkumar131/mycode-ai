import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderBox, renderCodeBlock } from '../renderer.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

describe('renderMarkdown', () => {
  it('renders empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });

  it('renders plain text', () => {
    const out = renderMarkdown('Hello world');
    expect(stripAnsi(out)).toContain('Hello world');
  });

  it('renders headings', () => {
    const h1 = renderMarkdown('# Title');
    const h2 = renderMarkdown('## Subtitle');
    expect(stripAnsi(h1)).toContain('Title');
    expect(stripAnsi(h2)).toContain('Subtitle');
  });

  it('renders bold and italic', () => {
    const bold = renderMarkdown('**bold**');
    const italic = renderMarkdown('*italic*');
    expect(stripAnsi(bold)).toContain('bold');
    expect(stripAnsi(italic)).toContain('italic');
  });

  it('renders code blocks', () => {
    const out = renderMarkdown('```js\nconsole.log(1)\n```');
    expect(stripAnsi(out)).toContain('console.log(1)');
  });

  it('renders inline code', () => {
    const out = renderMarkdown('Use `code` here');
    expect(stripAnsi(out)).toContain('code');
  });

  it('renders lists', () => {
    const out = renderMarkdown('- item 1\n- item 2');
    const plain = stripAnsi(out);
    expect(plain).toContain('item 1');
    expect(plain).toContain('item 2');
    expect(plain).toContain('\u2022');
  });

  it('renders ordered lists', () => {
    const out = renderMarkdown('1. first\n2. second');
    const plain = stripAnsi(out);
    expect(plain).toContain('1.');
    expect(plain).toContain('first');
    expect(plain).toContain('second');
  });

  it('renders links', () => {
    const out = renderMarkdown('[text](https://x.com)');
    const plain = stripAnsi(out);
    expect(plain).toContain('text');
  });

  it('renders blockquotes', () => {
    const out = renderMarkdown('> Quote');
    const plain = stripAnsi(out);
    expect(plain).toContain('Quote');
  });

  it('renders horizontal rules', () => {
    const out = renderMarkdown('---');
    expect(out.length).toBeGreaterThan(1);
  });

  it('renders complex markdown without errors', () => {
    const md = [
      '# Welcome',
      '',
      'This is a **test** with `code` and more.',
      '',
      '- list item with *italic*',
      '- another item',
      '',
      '```ts',
      'const x: string = "hello";',
      '```',
    ].join('\n');
    expect(() => renderMarkdown(md)).not.toThrow();
    const plain = stripAnsi(renderMarkdown(md));
    expect(plain).toContain('Welcome');
    expect(plain).toContain('hello');
  });
});

describe('renderBox', () => {
  it('renders a box with title and content', () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => log.push(args.join(' ')));
    renderBox('Test Title', 'Content line');
    spy.mockRestore();
    expect(log.length).toBeGreaterThan(0);
    expect(log.some(l => l.includes('Test Title'))).toBe(true);
    expect(log.some(l => l.includes('Content line'))).toBe(true);
  });
});

describe('renderCodeBlock', () => {
  it('renders a code block with language header', () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => log.push(args.join(' ')));
    renderCodeBlock('const x = 1;', 'js');
    spy.mockRestore();
    expect(log.length).toBeGreaterThan(0);
    expect(log.some(l => l.includes('js'))).toBe(true);
  });
});
