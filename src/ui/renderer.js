/**
 * Terminal Markdown Renderer
 * Renders AI responses as beautifully formatted markdown in the terminal.
 */

import chalk from 'chalk';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Configure marked with terminal rendering
const marked = new Marked();
marked.use(
  markedTerminal({
    code: chalk.hex('#E2E8F0').bgHex('#1E293B'),
    codespan: chalk.hex('#F472B6').bgHex('#1E293B'),
    blockquote: chalk.hex('#94A3B8').italic,
    heading: chalk.hex('#A78BFA').bold,
    firstHeading: chalk.hex('#7C3AED').bold,
    strong: chalk.hex('#FBBF24').bold,
    em: chalk.italic,
    del: chalk.strikethrough.dim,
    link: chalk.hex('#38BDF8').underline,
    href: chalk.hex('#38BDF8').underline,
    listitem: chalk.hex('#E2E8F0'),
    table: chalk.hex('#E2E8F0'),
    paragraph: chalk.hex('#CBD5E1'),
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
    process.stdout.write(rendered);
  } catch {
    // Fallback to plain text if markdown rendering fails
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
      console.log(chalk.hex('#34D399')(line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(chalk.hex('#F87171')(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.hex('#38BDF8')(line));
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      console.log(chalk.bold(line));
    } else {
      console.log(chalk.dim(line));
    }
  }
}

/**
 * Render a code block with a header showing the language.
 * @param {string} code - The code content
 * @param {string} language - Programming language
 * @param {string} filename - Optional filename
 */
export function renderCodeBlock(code, language = '', filename = '') {
  const header = filename || language || 'code';
  console.log();
  console.log(chalk.hex('#475569').bgHex('#1E293B')(` ${header} `));
  console.log(chalk.hex('#E2E8F0').bgHex('#0F172A')(code));
  console.log();
}

/**
 * Render a boxed message.
 * @param {string} title - Box title
 * @param {string} content - Box content
 * @param {string} color - Hex color for the border
 */
export function renderBox(title, content, color = '#7C3AED') {
  const width = Math.min(process.stdout.columns || 80, 70);
  const border = chalk.hex(color);

  console.log(border('┌' + '─'.repeat(width - 2) + '┐'));
  console.log(border('│') + ' ' + chalk.bold(title).padEnd(width - 3) + border('│'));
  console.log(border('├' + '─'.repeat(width - 2) + '┤'));

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.slice(0, width - 4);
    console.log(border('│') + ' ' + trimmed.padEnd(width - 3) + border('│'));
  }

  console.log(border('└' + '─'.repeat(width - 2) + '┘'));
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
