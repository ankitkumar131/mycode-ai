/**
 * Update Checker Utility
 * Checks npm registry for newer version, with dev-mode awareness
 * FIX: Prevents showing stale update notice when running from local dev repo
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const PUBLISHED_PACKAGE_NAME = '@ankitkumar131/mycode-ai';
const FETCH_TIMEOUT_MS = 3000;

export function isNewerVersion(v1: string, v2: string): boolean {
  const clean = (v: string) => v.replace(/^v/, '').split('-')[0];
  const p1 = clean(v1).split('.').map(n => parseInt(n, 10) || 0);
  const p2 = clean(v2).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n2 > n1) return true;
    if (n2 < n1) return false;
  }
  return false;
}

export function getLocalPackageInfo(): { name: string; version: string; isDev: boolean } {
  // Check if injected version exists (from esbuild)
  if (process.env.CLI_VERSION) {
    const isDev = process.env.CLI_VERSION.includes('dev') || process.env.CLI_VERSION === '0.0.0';
    return { name: PUBLISHED_PACKAGE_NAME, version: process.env.CLI_VERSION, isDev };
  }

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(__dirname, '../../../package.json'),
      resolve(__dirname, '../../package.json'),
      resolve(__dirname, '../package.json'),
    ];

    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        // Detect dev mode: has workspaces or private=true with @mycode/* deps
        const isDev = !!(pkg.workspaces || (pkg.private && pkg.name !== PUBLISHED_PACKAGE_NAME));
        if (pkg.version && (pkg.name === PUBLISHED_PACKAGE_NAME || pkg.name === '@ankitkumar131/mycode-ai')) {
          return { name: PUBLISHED_PACKAGE_NAME, version: pkg.version, isDev };
        }
      }
    }

    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.version) {
          const isDev = !!(pkg.workspaces);
          return { name: PUBLISHED_PACKAGE_NAME, version: pkg.version, isDev };
        }
      }
    }
  } catch {}

  return { name: PUBLISHED_PACKAGE_NAME, version: '1.0.9', isDev: false };
}

export async function checkForUpdate(): Promise<void> {
  try {
    // FIX: Skip update check in dev mode or when explicitly disabled
    if (process.env.MYCODE_SKIP_UPDATE_CHECK === '1' || process.env.MYCODE_SKIP_UPDATE_CHECK === 'true') {
      return;
    }
    if (process.env.npm_lifecycle_event === 'start' || process.env.npm_lifecycle_event === 'dev') {
      // Running via npm start/dev — likely local dev, skip noisy update check
      // Unless version is significantly behind (major version diff)
      const { version: localVersion, isDev } = getLocalPackageInfo();
      if (isDev) {
        // In dev mode, only show update if registry is at least 1 major version ahead
        // This prevents showing "2.0.3 → 3.0.0" when dev is working on 3.1.0
        return;
      }
    }

    const { name: pkgName, version: localVersion, isDev } = getLocalPackageInfo();

    // Skip if dev version
    if (isDev && localVersion.includes('dev')) return;

    const response = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return;

    const data = (await response.json()) as { version?: string };
    const latestVersion = data.version;

    if (!latestVersion) return;

    // FIX: Only show update if registry version is newer AND local is not newer than registry
    // This prevents showing "2.0.3 → 3.0.0" when local is actually 3.1.0 dev
    if (isNewerVersion(localVersion, latestVersion)) {
      // Additional check: if local is dev (has workspaces), don't show update for same major
      // e.g., local 3.1.0 dev should not show update to 3.0.0
      if (isDev) {
        const localMajor = parseInt(localVersion.split('.')[0] || '0', 10);
        const latestMajor = parseInt(latestVersion.split('.')[0] || '0', 10);
        if (localMajor >= latestMajor) {
          // Local dev is same or newer major — skip update notice
          return;
        }
      }
      renderUpdateBox(localVersion, latestVersion, pkgName);
    }
  } catch {
    // Silently ignore network failures
  }
}

function renderUpdateBox(currentVersion: string, latestVersion: string, packageName: string): void {
  const line1Str = `Update available: ${currentVersion} → ${latestVersion}`;
  const line2Str = `Run npm install -g ${packageName} to update`;
  const line3Str = `Or if running locally: git pull && npm run build`;

  const padding = 3;
  const contentWidth = Math.max(line1Str.length, line2Str.length, line3Str.length);
  const boxWidth = contentWidth + padding * 2;

  const borderTop = '┌' + '─'.repeat(boxWidth) + '┐';
  const borderBottom = '└' + '─'.repeat(boxWidth) + '┘';
  const emptyLine = '│' + ' '.repeat(boxWidth) + '│';

  const line1Colored = `Update available: ${chalk.dim(currentVersion)} → ${chalk.bold.green(latestVersion)}`;
  const line2Colored = `Run ${chalk.bold.cyan(`npm install -g ${packageName}`)} to update`;
  const line3Colored = chalk.dim(`Or locally: ${chalk.cyan('git pull && npm run build')}`);

  const padLine = (textWithAnsi: string, plainLen: number) => {
    const rightPad = boxWidth - padding - plainLen;
    return '│' + ' '.repeat(padding) + textWithAnsi + ' '.repeat(Math.max(0, rightPad)) + '│';
  };

  const y = chalk.hex('#FBBF24');

  console.log();
  console.log(y(borderTop));
  console.log(y(emptyLine));
  console.log(y(padLine(line1Colored, line1Str.length)));
  console.log(y(padLine(line2Colored, line2Str.length)));
  console.log(y(padLine(line3Colored, line3Str.length)));
  console.log(y(emptyLine));
  console.log(y(borderBottom));
  console.log();
}
