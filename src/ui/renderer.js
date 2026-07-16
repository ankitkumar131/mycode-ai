/**
 * Terminal Markdown Renderer
 * Gemini CLI-inspired: clean, readable markdown rendering with refined colors.
 */

import chalk from 'chalk';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// ── Brand colors consistent with the rest of the UI ────────────────────────

const BRAND = {
  text: '#E5E7EB',
  muted: '#9CA3AF',
  dim: '#6B7280',
  heading: '#60A5FA',
  headingBold: '#93C5FD',
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

// Configure marked with terminal rendering
const marked = new Marked();
marked.use(
  markedTerminal({
    code: chalk.hex(BRAND.code).bgHex(BRAND.codeBg),
    codespan: chalk.hex(BRAND.codespan).bgHex(BRAND.codeBg),
    blockquote: chalk.hex(BRAND.blockquote).italic,
    heading: chalk.hex(BRAND.headingBold).bold,
    firstHeading: chalk.hex(BRAND.heading).bold,
    strong: chalk.hex(BRAND.strong).bold,
    em: chalk.italic,
    del: chalk.strikethrough.dim,
    link: chalk.hex(BRAND.link).underline,
    href: chalk.hex(BRAND.link).underline,
    listitem: chalk.hex(BRAND.text),
    table: chalk.hex(BRAND.text),
    paragraph: chalk.hex(BRAND.text),
    tab: 2,
    width: Math.min(process.stdout.columns || 80, 100),
  })
);

/**
 * Render markdown text to the terminal.
 * @param {string} text - Raw markdown text
 */
export function renderMarkdown(text) {
  if (!text || !text.trim()) return;

  try {
    const rendered = marked.parse(text);
    // Add 2-space indent to match Gemini's response alignment
    const indented = rendered
      .split('\n')
      .map(line => (line.trim() ? `  ${line}` : line))
      .join('\n');
    process.stdout.write(indented);
  } catch {
    // Fallback to plain text
    console.log(text);
  }
}

/**
 * Render a diff with color coding.
 * @param {string} diffText - Unified diff string
 */
export function renderDiff(diffText) {
  const lines = diffText.split('\n');

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(`  ${chalk.hex(BRAND.diffAdd)(line)}`);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(`  ${chalk.hex(BRAND.diffDel)(line)}`);
    } else if (line.startsWith('@@')) {
      console.log(`  ${chalk.hex(BRAND.diffHunk)(line)}`);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      console.log(`  ${chalk.bold(line)}`);
    } else {
      console.log(`  ${chalk.hex(BRAND.dim)(line)}`);
    }
  }
}

/**
 * Render a code block with a header showing the language.
 * Gemini-style: subtle header bar with language label.
 * @param {string} code - The code content
 * @param {string} language - Programming language
 * @param {string} filename - Optional filename
 */
export function renderCodeBlock(code, language = '', filename = '') {
  const header = filename || language || 'code';
  console.log();
  console.log(`  ${chalk.hex(BRAND.dim).bgHex(BRAND.codeBg)(` ${header} `)}`);
  console.log(`  ${chalk.hex(BRAND.code).bgHex('#111827')(code)}`);
  console.log();
}

/**
 * Render a boxed message — clean, minimal style.
 * @param {string} title - Box title
 * @param {string} content - Box content
 * @param {string} color - Hex color for the border
 */
export function renderBox(title, content, color = '#60A5FA') {
  const width = Math.min(process.stdout.columns || 80, 70);
  const border = chalk.hex(color);

  console.log(`  ${border('┌' + '─'.repeat(width - 4) + '┐')}`);
  console.log(`  ${border('│')} ${chalk.bold(title).padEnd(width - 5)} ${border('│')}`);
  console.log(`  ${border('├' + '─'.repeat(width - 4) + '┤')}`);

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.slice(0, width - 6);
    console.log(`  ${border('│')} ${trimmed.padEnd(width - 5)} ${border('│')}`);
  }

  console.log(`  ${border('└' + '─'.repeat(width - 4) + '┘')}`);
}

/**
 * Stream text character by character for a typing effect.
 * @param {string} text - Text to stream
 * @param {number} delayMs - Delay between characters (0 for immediate)
 */
export async function streamText(text, delayMs = 0) {
  if (delayMs === 0) {
    process.stdout.write(text);
    return;
  }

  for (const char of text) {
    process.stdout.write(char);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
