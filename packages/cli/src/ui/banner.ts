import chalk from 'chalk';
import { platform } from 'os';
import { theme, heavyDivider } from './themes/theme.js';

interface BannerOptions {
  version: string;
  model: string;
  providerChain: string[];
  cwd: string;
  nodeVersion?: string;
  /**
   * Short build identity (commit + build time) when running from a source
   * checkout. Reported so "am I actually running the build with that fix?" is
   * answerable at a glance instead of by guessing.
   */
  build?: string | null;
  /** Whether approvals are currently being asked for. */
  approvals?: { writes: boolean; commands: boolean };
  /** Active ponytail mode description, e.g. "ponytail: full (default)". */
  ponytail?: string | null;
}

export function renderBanner(opts: BannerOptions): void {
  const isWindows = platform() === 'win32';
  const osLabel = isWindows ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';
  const shell = isWindows ? 'PowerShell' : process.env.SHELL?.split('/').pop() || 'sh';
  const nodeV = opts.nodeVersion || process.version;

  console.log();
  console.log(heavyDivider());
  console.log(
    chalk.hex(theme.green).bold(`
  ███╗   ███╗██╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗
  ████╗ ████║╚██╗ ██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ██╔████╔██║ ╚████╔╝ ██║     ██║   ██║██║  ██║█████╗  
  ██║╚██╔╝██║  ╚██╔╝  ██║     ██║   ██║██║  ██║██╔══╝  
  ██║ ╚═╝ ██║   ██║   ╚██████╗╚██████╔╝██████╔╝███████╗
  ╚═╝     ╚═╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
`)
  );
  console.log(heavyDivider());
  console.log();
  console.log(
    `  ${chalk.hex(theme.green)('◆')} ${chalk.hex(theme.white).bold('MyCode Agent')} ${chalk.hex(theme.dim)(`v${opts.version}`)}`
  );
  console.log(`  ${chalk.hex(theme.greenMute)('model:')} ${chalk.hex(theme.greenGlow).bold(opts.model || 'None')}`);
  console.log(`  ${chalk.hex(theme.greenMute)('cwd:')}   ${chalk.hex(theme.muted)(opts.cwd)}`);
  if (opts.providerChain.length > 0) {
    console.log(`  ${chalk.hex(theme.greenMute)('chain:')} ${chalk.hex(theme.dim)(opts.providerChain.join(' → '))}`);
  }
  console.log(`  ${chalk.hex(theme.dim)(`${osLabel} · ${shell} · Node ${nodeV}`)}`);
  if (opts.build) {
    console.log(`  ${chalk.hex(theme.greenMute)('build:')} ${chalk.hex(theme.dim)(opts.build)}`);
  }
  if (opts.ponytail) {
    console.log(`  ${chalk.hex(theme.amber)('🐴')} ${chalk.hex(theme.dim)(opts.ponytail)} ${chalk.hex(theme.muted)('— /ponytail off to disable')}`);
  }
  console.log();
  console.log(
    `  ${chalk.hex(theme.dim)('Enter to send')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('Ctrl+Enter new line')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('↑/↓ edit & history')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('Ctrl+G editor')}`
  );
  console.log(
    `  ${chalk.hex(theme.dim)('Use')} ${chalk.hex(theme.green).bold('/')} ${chalk.hex(theme.dim)('for commands (live menu),')} ${chalk.hex(theme.green).bold('!cmd')} ${chalk.hex(theme.dim)('to run shell,')} ${chalk.hex(theme.green).bold('@file')} ${chalk.hex(theme.dim)('to inject files.')}`
  );

  // If the session is going to interrupt the user, say so up front and name the
  // way out. Discovering /allow-all only after the fortieth prompt is the
  // difference between a usable agent and an unusable one.
  const appr = opts.approvals;
  if (appr && (appr.writes || appr.commands)) {
    const what = appr.writes && appr.commands ? 'file writes and commands' : appr.writes ? 'file writes' : 'commands';
    console.log(
      `  ${chalk.hex(theme.amber)('Approvals on')} ${chalk.hex(theme.dim)(`for ${what} — run`)} ${chalk.hex(theme.green).bold('/allow-all')} ${chalk.hex(theme.dim)('to stop being asked for this session (or pick “always allow” at any prompt).')}`
    );
  }
  console.log();
}

export function renderUpdateNotice(currentVersion: string, latestVersion: string, packageName: string): void {
  console.log();
  console.log(`  ${chalk.hex(theme.amber)(`[Update Available] v${currentVersion} -> v${latestVersion}`)}`);
  console.log(`  ${chalk.hex(theme.dim)(`Run: npm install -g ${packageName}`)}`);
  console.log();
}
