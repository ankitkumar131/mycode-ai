/**
 * webSearchTool — Web search tool to retrieve live information and search results from the web.
 */

import type { ToolModule } from '../types.js';

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

function parseDuckDuckGoLite(html: string, limit = 5): SearchResultItem[] {
  const links: Array<{ url: string; title: string }> = [];
  const tagRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[0];
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    const title = match[1].replace(/<[^>]+>/g, '').trim();

    if (hrefMatch && title) {
      const rawUrl = hrefMatch[1];
      let url = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          url = decodeURIComponent(uddgMatch[1]);
        } catch {
          url = rawUrl;
        }
      }
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  const snippetRegex = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  const results: SearchResultItem[] = [];
  for (let i = 0; i < Math.min(links.length, limit); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

export const webSearchTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for up-to-date information, documentation, news, or technical questions using web search.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web.',
          },
          numResults: {
            type: 'number',
            description: 'Number of search results to return (default 5, max 10).',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const numResults = typeof args.numResults === 'number' ? Math.min(Math.max(1, args.numResults), 10) : 5;

    if (!query) {
      throw new Error('Search query must not be empty.');
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        signal: controller.signal,
        body: new URLSearchParams({ q: query }),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const results = parseDuckDuckGoLite(html, numResults);

      if (results.length === 0) {
        return `Web Search Query: "${query}"\nNo results found.`;
      }

      const formatted = results.map((r, i) =>
        `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    Snippet: ${r.snippet}`
      ).join('\n\n');

      return `Web Search Results for "${query}":\n\n${formatted}`;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Search request timed out for query: "${query}"`);
      }
      throw new Error(`Web search failed: ${err.message}`);
    }
  },
};
