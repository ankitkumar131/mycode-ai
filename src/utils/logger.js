/**
 * Logger Utility
 * Gemini CLI-inspired, clean, consistent styled logging.
 * Uses ✦ sparkle as the primary brand icon.
 */

import chalk from 'chalk';

// ── Brand Colors ────────────────────────────────────────────────────────────

const BRAND = {
  primary: '#4285F4',    // Google Blue
  accent: '#A78BFA',     // Soft purple
  sparkle: '#60A5FA',    // Light blue for ✦
  success: '#34D399',
  warning: '#FBBF24',
  error: '#EF4444',
  dim: '#6B7280',
  text: '#E5E7EB',
  muted: '#9CA3AF',
};

const ICONS = {
  sparkle: chalk.hex(BRAND.sparkle)('✦'),
  success: chalk.hex(BRAND.success)('✔'),
  warn: chalk.hex(BRAND.warning)('⚠'),
  error: chalk.hex(BRAND.error)('✖'),
  arrow: chalk.hex(BRAND.dim)('→'),
  info: chalk.hex(BRAND.sparkle)('●'),
  tool: chalk.hex(BRAND.accent)('⬡'),
  file: chalk.hex(BRAND.sparkle)('📄'),
  dir: chalk.hex(BRAND.warning)('📁'),
  edit: chalk.hex(BRAND.accent)('✏'),
  search: chalk.hex(BRAND.sparkle)('🔍'),
  cmd: chalk.hex(BRAND.muted)('$'),
  git: chalk.hex(BRAND.success)('⎇'),
  switch: chalk.hex(BRAND.warning)('↻'),
};

// ── Tool Icons (Gemini-style: show what happened in one compact line) ────────

const TOOL_ICONS = {
  readFile: { icon: '📄', verb: 'Read', color: BRAND.sparkle },
  writeFile: { icon: '✏️', verb: 'Wrote', color: BRAND.accent },
  editFile: { icon: '✏️', verb: 'Edited', color: BRAND.accent },
  listDirectory: { icon: '📁', verb: 'Listed', color: BRAND.warning },
  searchFiles: { icon: '🔍', verb: 'Searched', color: BRAND.sparkle },
  executeCommand: { icon: '⚡', verb: 'Ran', color: BRAND.muted },
  gitStatus: { icon: '⎇', verb: 'Checked git', color: BRAND.success },
};

export const logger = {
  /**
   * Informational message
   */
  info(msg) {
    console.log(`  ${ICONS.info} ${chalk.hex(BRAND.muted)(msg)}`);
  },

  /**
   * Success message
   */
  success(msg) {
    console.log(`  ${ICONS.success} ${chalk.hex(BRAND.success)(msg)}`);
  },

  /**
   * Warning message
   */
  warn(msg) {
    console.log(`  ${ICONS.warn} ${chalk.hex(BRAND.warning)(msg)}`);
  },

  /**
   * Error message
   */
  error(msg) {
    console.error(`  ${ICONS.error} ${chalk.hex(BRAND.error)(msg)}`);
  },

  /**
   * Provider-related message
   */
  provider(msg) {
    console.log(`  ${ICONS.sparkle} ${chalk.hex(BRAND.accent)(msg)}`);
  },

  /**
   * Tool execution — Gemini-style compact one-liner.
   * Shows: ✦ Read src/index.js (42 lines)
   */
  tool(toolName, detail) {
    const meta = TOOL_ICONS[toolName] || { icon: '⬡', verb: toolName, color: BRAND.accent };
    console.log(
      `  ${chalk.hex(meta.color)(meta.icon)} ${chalk.hex(meta.color).bold(meta.verb)} ${chalk.hex(BRAND.muted)(detail)}`
    );
  },

  /**
   * Tool result — compact summary shown under the tool line.
   * Only for non-command tools. Gemini shows a brief result, not a wall of text.
   */
  toolResult(toolName, result) {
    if (!result) return;

    const meta = TOOL_ICONS[toolName] || { color: BRAND.accent };

    // Show a very brief summary: first meaningful line or truncated
    const lines = result.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    // For readFile, show line count
    if (toolName === 'readFile') {
      const lineMatch = result.match(/lines (\d+)-(\d+) of (\d+)/);
      if (lineMatch) {
        const [, start, end, total] = lineMatch;
        const range = start === '1' && end === total
          ? `${total} lines`
          : `lines ${start}–${end} of ${total}`;
        console.log(chalk.hex(BRAND.dim)(`    ${range}`));
      }
      return;
    }

    // For listDirectory, show file count
    if (toolName === 'listDirectory') {
      const entryCount = lines.filter(l => l.includes('│')).length;
      if (entryCount > 0) {
        console.log(chalk.hex(BRAND.dim)(`    ${entryCount} entries`));
      }
      return;
    }

    // For searchFiles, show match count
    if (toolName === 'searchFiles') {
      const matchCount = lines.filter(l => l.match(/^\s*\d+\s*│/)).length;
      if (matchCount > 0) {
        console.log(chalk.hex(BRAND.dim)(`    ${matchCount} matches found`));
      }
      return;
    }

    // For git, show brief status
    if (toolName === 'gitStatus') {
      const statusLine = lines.find(l => l.includes('Branch:') || l.includes('On branch'));
      if (statusLine) {
        console.log(chalk.hex(BRAND.dim)(`    ${statusLine.trim()}`));
      }
      return;
    }

    // For writeFile / editFile, show success
    if (toolName === 'writeFile' || toolName === 'editFile') {
      const firstLine = lines[0]?.trim();
      if (firstLine) {
        console.log(chalk.hex(BRAND.dim)(`    ${firstLine.slice(0, 80)}`));
      }
      return;
    }
  },

  /**
   * Provider switch / failover message
   */
  switch(from, to, reason) {
    console.log(
      `  ${ICONS.switch} ${chalk.hex(BRAND.warning)(`Switching ${chalk.bold(from)} → ${chalk.bold(to)}`)} ${chalk.hex(BRAND.dim)(`(${reason})`)}`
    );
  },

  /**
   * Blank line for spacing
   */
  blank() {
    console.log();
  },

  /**
   * Divider line
   */
  divider() {
    console.log(chalk.hex(BRAND.dim)('  ' + '─'.repeat(48)));
  },

  /**
   * Branded header — Gemini CLI-inspired clean startup banner.
   * Shows sparkle icon, app name, version, and current model.
   */
  header(version = '', model = '') {
    console.log();
    console.log(
      `  ${chalk.hex(BRAND.sparkle).bold('✦')} ${chalk.hex(BRAND.text).bold('MyCode')} ${version ? chalk.hex(BRAND.dim)(`v${version}`) : ''}`
    );

    if (model) {
      console.log(`  ${chalk.hex(BRAND.dim)(`model: ${model}`)}`);
    }

    console.log();
  },

  /**
   * Compact token usage — Gemini-style subtle footer.
   */
  tokens(inTokens, outTokens, estimated = false) {
    const prefix = estimated ? '~' : '';
    console.log(
      chalk.hex(BRAND.dim)(
        `  ${prefix}${inTokens.toLocaleString()} input → ${prefix}${outTokens.toLocaleString()} output tokens`
      )
    );
  },
};

export default logger;
export { BRAND, TOOL_ICONS };
