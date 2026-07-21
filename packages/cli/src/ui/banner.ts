/**
 * Startup Banner — Gemini CLI-inspired branded header.
 * Shows version, model, OS, shell, and working directory.
 */

import chalk from 'chalk';
import { platform, hostname } from 'os';
import { COLORS, S, ICONS, hr, getWidth } from './themes/theme.js';

interface BannerOptions {
  version: string;
  model: string;
  providerChain: string[];
  cwd: string;
  nodeVersion?: string;
}

/**
 * Render the premium startup banner.
 */
export function renderBanner(opts: BannerOptions): void {
  const isWindows = platform() === 'win32';
  const osLabel = isWindows ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';
  const shell = isWindows ? 'PowerShell' : process.env.SHELL?.split('/').pop() || 'sh';
  const nodeV = opts.nodeVersion || process.version;

  console.log();

  // ── Title line ──
  console.log(
    `  ${chalk.hex(COLORS.sparkle).bold(ICONS.sparkle)} ${chalk.hex(COLORS.text).bold('MyCode')} ${S.dim(`v${opts.version}`)}`
  );

  // ── Model ──
  if (opts.model) {
    console.log(`  ${S.dim('model:')} ${S.accent(opts.model)}`);
  }

  // ── Context info ──
  console.log(`  ${S.dim('cwd:')}   ${S.muted(opts.cwd)}`);

  // ── Provider chain ──
  if (opts.providerChain.length > 0) {
    const chain = opts.providerChain.join(S.dim(` ${ICONS.arrow} `));
    console.log(`  ${S.dim('chain:')} ${S.muted(chain)}`);
  }

  // ── System info ──
  console.log(
    `  ${S.dim(`${osLabel} · ${shell} · Node ${nodeV}`)}`
  );

  console.log();

  // ── Hint ──
  console.log(
    `  ${S.dim('Type your message. Use')} ${S.brand('/help')} ${S.dim('for commands,')} ${S.brand('/exit')} ${S.dim('to quit.')}`
  );

  console.log();
}

/**
 * Render a compact update notification.
 */
export function renderUpdateNotice(currentVersion: string, latestVersion: string, packageName: string): void {
  const w = getWidth(60);
  const border = chalk.hex(COLORS.accentGold);

  console.log();
  console.log(
    `  ${border(ICONS.corner.topLeft + ICONS.dash.repeat(w - 4) + ICONS.corner.topRight)}`
  );
  console.log(
    `  ${border(ICONS.bar)} ${chalk.hex(COLORS.accentGold)(`Update available: ${S.dim(currentVersion)} ${ICONS.arrow} ${S.successBold(latestVersion)}`).padEnd(w + 15)} ${border(ICONS.bar)}`
  );
  console.log(
    `  ${border(ICONS.bar)} ${S.muted(`Run ${S.cyanBold(`npm i -g ${packageName}`)} to update`).padEnd(w + 15)} ${border(ICONS.bar)}`
  );
  console.log(
    `  ${border(ICONS.corner.bottomLeft + ICONS.dash.repeat(w - 4) + ICONS.corner.bottomRight)}`
  );
  console.log();
}
