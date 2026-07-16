/**
 * Context Resolver
 * Resolves @file and @directory references in user prompts,
 * reading their contents and appending them to the prompt context.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { resolve, relative, join, basename } from 'path';

const SKIP_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', 'bin', 'obj', 'vendor'];
const SKIP_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.tar', '.gz', '.mp3', '.mp4', '.exe', '.dll', '.so', '.dylib'];

/**
 * Scan a message for @references, read the targets, and append their contents.
 * @param {string} message - The original user prompt
 * @param {string} cwd - Current working directory
 * @returns {{ resolvedPrompt: string, filesInjected: string[] }}
 */
export function resolveContextReferences(message, cwd) {
  // Regex to match @paths (e.g. @src/index.js or @package.json)
  // Avoids email addresses by requiring boundary or whitespace before @
  const regex = /(?:^|\s)@([^\s]+)/g;
  const filesInjected = [];
  let enrichedPrompt = message;
  let matches;

  const resolvedPaths = new Set();
  const fileContents = [];

  // Reset regex state
  regex.lastIndex = 0;

  while ((matches = regex.exec(message)) !== null) {
    const rawPath = matches[1];
    const fullPath = resolve(cwd, rawPath);

    if (resolvedPaths.has(fullPath)) continue;
    resolvedPaths.add(fullPath);

    if (existsSync(fullPath)) {
      const stat = statSync(fullPath);

      if (stat.isFile()) {
        const result = readFileContent(fullPath, cwd);
        if (result) {
          fileContents.push(result);
          filesInjected.push(relative(cwd, fullPath));
        }
      } else if (stat.isDirectory()) {
        const results = readDirectoryContents(fullPath, cwd);
        for (const res of results) {
          if (!resolvedPaths.has(res.fullPath)) {
            resolvedPaths.add(res.fullPath);
            fileContents.push(res.content);
            filesInjected.push(relative(cwd, res.fullPath));
          }
        }
      }
    }
  }

  if (fileContents.length > 0) {
    enrichedPrompt += '\n\n' + fileContents.join('\n\n');
  }

  return {
    resolvedPrompt: enrichedPrompt,
    filesInjected,
  };
}

function isBinaryOrLarge(filePath, stat) {
  if (stat.size > 500_000) return true; // Skip files > 500KB

  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (SKIP_EXTS.includes(ext)) return true;

  return false;
}

function readFileContent(filePath, cwd) {
  try {
    const stat = statSync(filePath);
    if (isBinaryOrLarge(filePath, stat)) {
      return `\n--- File Reference: ${relative(cwd, filePath)} (Injected) ---\n[Binary or large file omitted]`;
    }

    const content = readFileSync(filePath, 'utf-8');
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase().replace('.', '');
    const lang = ext && ext.length < 10 ? ext : '';

    return `\n--- Injected File Context: ${relative(cwd, filePath)} ---\n\`\`\`${lang}\n${content}\n\`\`\``;
  } catch {
    return null;
  }
}

function readDirectoryContents(dirPath, cwd, maxFiles = 10) {
  const results = [];
  let fileCount = 0;

  function traverse(currentDir) {
    if (fileCount >= maxFiles) return;

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (fileCount >= maxFiles) break;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
            traverse(fullPath);
          }
        } else if (entry.isFile()) {
          if (entry.name.startsWith('.')) continue;

          const stat = statSync(fullPath);
          if (!isBinaryOrLarge(fullPath, stat)) {
            const content = readFileContent(fullPath, cwd);
            if (content) {
              results.push({ fullPath, content });
              fileCount++;
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  traverse(dirPath);
  return results;
}
