/**
 * Update Checker Utility
 * Checks npm registry on every run for a newer version of @ankitkumar131/mycode-ai.
 * Prompts the user with a styled update box and the exact `npm i -g @ankitkumar131/mycode-ai` command.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const PUBLISHED_PACKAGE_NAME = '@ankitkumar131/mycode-ai';
const FETCH_TIMEOUT_MS = 3000;

/**
 * Compare two semver strings (e.g. "1.0.6" > "1.0.5").
 * Returns true if v2 is strictly newer than v1.
 */
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

/**
 * Get current installed package version and name.
 */
export function getLocalPackageInfo(): { name: string; version: string } {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));

    // Search upwards for package.json
    const candidates = [
      resolve(__dirname, '../package.json'),
      resolve(__dirname, '../../package.json'),
      resolve(__dirname, '../../../package.json'),
    ];

    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name) {
          return {
            name: pkg.name === '@mycode/cli' ? PUBLISHED_PACKAGE_NAME : pkg.name,
            version: pkg.version || '1.0.0',
          };
        }
      }
    }
  } catch {
    // Fallback
  }

  return { name: PUBLISHED_PACKAGE_NAME, version: '1.0.0' };
}

/**
 * Check npm registry for new release and display update prompt if available.
 * Non-blocking, max 3s timeout.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const { name: pkgName, version: localVersion } = getLocalPackageInfo();

    const response = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return;

    const data = (await response.json()) as { version?: string };
    const latestVersion = data.version;

    if (latestVersion && isNewerVersion(localVersion, latestVersion)) {
      renderUpdateBox(localVersion, latestVersion, pkgName);
    }
  } catch {
    // Silently ignore network failures or offline mode
  }
}

/**
 * Render update notice box to terminal.
 */
function renderUpdateBox(currentVersion: string, latestVersion: string, packageName: string): void {
  const line1Str = `Update available: ${currentVersion} → ${latestVersion}`;
  const line2Str = `Run npm install -g ${packageName} to update`;

  const padding = 3;
  const contentWidth = Math.max(line1Str.length, line2Str.length);
  const boxWidth = contentWidth + padding * 2;

  const borderTop = '┌' + '─'.repeat(boxWidth) + '┐';
  const borderBottom = '└' + '─'.repeat(boxWidth) + '┘';
  const emptyLine = '│' + ' '.repeat(boxWidth) + '│';

  const line1Colored = `Update available: ${chalk.dim(currentVersion)} → ${chalk.bold.green(latestVersion)}`;
  const line2Colored = `Run ${chalk.bold.cyan(`npm install -g ${packageName}`)} to update`;

  const padLine = (textWithAnsi: string, plainLen: number) => {
    const rightPad = boxWidth - padding - plainLen;
    return '│' + ' '.repeat(padding) + textWithAnsi + ' '.repeat(Math.max(0, rightPad)) + '│';
  };

  const y = chalk.hex('#FBBF24'); // Gold border

  console.log();
  console.log(y(borderTop));
  console.log(y(emptyLine));
  console.log(y(padLine(line1Colored, line1Str.length)));
  console.log(y(padLine(line2Colored, line2Str.length)));
  console.log(y(emptyLine));
  console.log(y(borderBottom));
  console.log();
}
