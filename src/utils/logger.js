/**
 * Logger Utility
 * Provides consistent, styled logging across the application.
 */

import chalk from 'chalk';

const ICONS = {
  info: chalk.hex('#60A5FA')('ℹ'),
  success: chalk.hex('#34D399')('✔'),
  warn: chalk.hex('#FBBF24')('⚠'),
  error: chalk.hex('#F87171')('✖'),
  provider: chalk.hex('#A78BFA')('⚡'),
  tool: chalk.hex('#38BDF8')('🔧'),
  switch: chalk.hex('#FB923C')('↻'),
};

export const logger = {
  /**
   * Informational message
   */
  info(msg) {
    console.log(`${ICONS.info} ${chalk.dim(msg)}`);
  },

  /**
   * Success message
   */
  success(msg) {
    console.log(`${ICONS.success} ${chalk.hex('#34D399')(msg)}`);
  },

  /**
   * Warning message
   */
  warn(msg) {
    console.log(`${ICONS.warn} ${chalk.hex('#FBBF24')(msg)}`);
  },

  /**
   * Error message
   */
  error(msg) {
    console.error(`${ICONS.error} ${chalk.hex('#F87171')(msg)}`);
  },

  /**
   * Provider-related message (which model is active, etc.)
   */
  provider(msg) {
    console.log(`${ICONS.provider} ${chalk.hex('#A78BFA')(msg)}`);
  },

  /**
   * Tool execution message
   */
  tool(toolName, msg) {
    console.log(`${ICONS.tool} ${chalk.hex('#38BDF8').bold(toolName)} ${chalk.dim(msg)}`);
  },

  /**
   * Provider switch / failover message
   */
  switch(from, to, reason) {
    console.log(
      `${ICONS.switch} ${chalk.hex('#FB923C')(`Switching from ${chalk.bold(from)} → ${chalk.bold(to)}`)} ${chalk.dim(`(${reason})`)}`
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
    console.log(chalk.dim('─'.repeat(50)));
  },

  /**
   * Branded header
   */
  header() {
    console.log();
    console.log(chalk.hex('#7C3AED').bold('  ⚡ MyCode') + chalk.dim(' — AI Coding Agent'));
    console.log(chalk.dim('  Multi-provider • Auto-failover'));
    console.log();
  },
};

export default logger;
