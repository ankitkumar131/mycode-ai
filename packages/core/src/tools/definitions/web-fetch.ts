/**
 * fetchWebPageTool — Fetch URL content and convert HTML to readable text
 */

import type { ToolModule } from '../types.js';

const MAX_CONTENT_LENGTH = 50_000;

function stripHtmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
  text = text.replace(/<[^>]+>/g, '');

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const fetchWebPageTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'fetchWebPage',
      description: 'Fetch web page content from a URL and convert HTML to clean markdown/text. Useful for reading online docs, READMEs, or articles.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL starting with http:// or https://',
          },
          maxLength: {
            type: 'number',
            description: 'Maximum characters to return (default 50000)',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args) {
    const url = typeof args.url === 'string' ? args.url : '';
    const maxLength = typeof args.maxLength === 'number' ? args.maxLength : MAX_CONTENT_LENGTH;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`URL must start with http:// or https://. Got: ${url}`);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'MyCode-CLI/1.0 (AI coding assistant)',
          'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      let text: string;
      if (contentType.includes('application/json')) {
        try {
          text = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          text = body;
        }
      } else if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
        text = body;
      } else {
        text = stripHtmlToText(body);
      }

      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + `\n\n... [Truncated: showing first ${maxLength} of ${body.length} characters]`;
      }

      return `URL: ${url}\nContent-Type: ${contentType}\nLength: ${text.length} chars\n\n${text}`;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after 30s for ${url}`);
      }
      throw new Error(`Failed to fetch web page: ${err.message}`);
    }
  },
};
