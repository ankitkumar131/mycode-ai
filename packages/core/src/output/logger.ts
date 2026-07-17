import chalk from 'chalk';

export const BRAND = {
  primary: '#4285F4',
  accent: '#A78BFA',
  sparkle: '#60A5FA',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#EF4444',
  dim: '#6B7280',
  text: '#E5E7EB',
  muted: '#9CA3AF',
};

const ICONS = {
  sparkle: chalk.hex(BRAND.sparkle)('\u2726'),
  success: chalk.hex(BRAND.success)('\u2714'),
  warn: chalk.hex(BRAND.warning)('\u26A0'),
  error: chalk.hex(BRAND.error)('\u2716'),
  arrow: chalk.hex(BRAND.dim)('\u2192'),
  info: chalk.hex(BRAND.sparkle)('\u25CF'),
  tool: chalk.hex(BRAND.accent)('\u2B21'),
  cmd: chalk.hex(BRAND.muted)('$'),
  switch: chalk.hex(BRAND.warning)('\u21BB'),
};

const TOOL_META: Record<string, { icon: string; verb: string; color: string }> = {
  readFile: { icon: '\uD83D\uDCC4', verb: 'Read', color: BRAND.sparkle },
  writeFile: { icon: '\u270F\uFE0F', verb: 'Wrote', color: BRAND.accent },
  editFile: { icon: '\u270F\uFE0F', verb: 'Edited', color: BRAND.accent },
  listDirectory: { icon: '\uD83D\uDCC1', verb: 'Listed', color: BRAND.warning },
  searchFiles: { icon: '\uD83D\uDD0D', verb: 'Searched', color: BRAND.sparkle },
  executeCommand: { icon: '\u26A1', verb: 'Ran', color: BRAND.muted },
  gitStatus: { icon: '\u2387', verb: 'Checked git', color: BRAND.success },
};

export const logger = {
  info(msg: string) {
    console.log(`  ${ICONS.info} ${chalk.hex(BRAND.muted)(msg)}`);
  },

  success(msg: string) {
    console.log(`  ${ICONS.success} ${chalk.hex(BRAND.success)(msg)}`);
  },

  warn(msg: string) {
    console.log(`  ${ICONS.warn} ${chalk.hex(BRAND.warning)(msg)}`);
  },

  error(msg: string) {
    console.error(`  ${ICONS.error} ${chalk.hex(BRAND.error)(msg)}`);
  },

  provider(msg: string) {
    console.log(`  ${ICONS.sparkle} ${chalk.hex(BRAND.accent)(msg)}`);
  },

  tool(toolName: string, detail: string) {
    const meta = TOOL_META[toolName] || { icon: '\u2B21', verb: toolName, color: BRAND.accent };
    console.log(
      `  ${chalk.hex(meta.color)(meta.icon)} ${chalk.hex(meta.color).bold(meta.verb)} ${chalk.hex(BRAND.muted)(detail)}`
    );
  },

  switchProviders(from: string, to: string, reason: string) {
    console.log(
      `  ${ICONS.switch} ${chalk.hex(BRAND.warning)(`Switching ${chalk.bold(from)} \u2192 ${chalk.bold(to)}`)} ${chalk.hex(BRAND.dim)(`(${reason})`)}`
    );
  },

  blank() {
    console.log();
  },

  divider() {
    console.log(chalk.hex(BRAND.dim)('  ' + '\u2500'.repeat(48)));
  },

  header(version = '', model = '') {
    console.log();
    console.log(
      `  ${chalk.hex(BRAND.sparkle).bold('\u2726')} ${chalk.hex(BRAND.text).bold('MyCode')} ${version ? chalk.hex(BRAND.dim)(`v${version}`) : ''}`
    );
    if (model) {
      console.log(`  ${chalk.hex(BRAND.dim)(`model: ${model}`)}`);
    }
    console.log();
  },

  tokens(inTokens: number, outTokens: number, estimated = false) {
    const prefix = estimated ? '~' : '';
    console.log(
      chalk.hex(BRAND.dim)(
        `  ${prefix}${inTokens.toLocaleString()} input \u2192 ${prefix}${outTokens.toLocaleString()} output tokens`
      )
    );
  },
};

export default logger;
