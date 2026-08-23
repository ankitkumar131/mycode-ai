import chalk from 'chalk';
import { platform } from 'os';
import { theme, heavyDivider } from './themes/theme.js';

interface BannerOptions {
  version: string;
  model: string;
  providerChain: string[];
  cwd: string;
  nodeVersion?: string;
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
  console.log();
  console.log(
    `  ${chalk.hex(theme.dim)('Enter to send')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('Shift+Enter new line')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('↑/↓ edit & history')} ${chalk.hex(theme.green)('·')} ${chalk.hex(theme.dim)('Ctrl+←/→ words')}`
  );
  console.log(
    `  ${chalk.hex(theme.dim)('Use')} ${chalk.hex(theme.green).bold('/')} ${chalk.hex(theme.dim)('for commands (live menu),')} ${chalk.hex(theme.green).bold('!cmd')} ${chalk.hex(theme.dim)('to run shell,')} ${chalk.hex(theme.green).bold('@file')} ${chalk.hex(theme.dim)('to inject files.')}`
  );
  console.log();
}

export function renderUpdateNotice(currentVersion: string, latestVersion: string, packageName: string): void {
  console.log();
  console.log(`  ${chalk.hex(theme.amber)(`[Update Available] v${currentVersion} -> v${latestVersion}`)}`);
  console.log(`  ${chalk.hex(theme.dim)(`Run: npm install -g ${packageName}`)}`);
  console.log();
}
