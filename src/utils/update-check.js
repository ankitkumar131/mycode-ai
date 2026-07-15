import chalk from 'chalk';

function parseVersion(version) {
  return String(version || '')
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(latest, current) {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < length; i++) {
    const latestPart = latestParts[i] || 0;
    const currentPart = currentParts[i] || 0;

    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
}

async function fetchLatestVersion(packageName, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    return body?.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function maybeCheckForUpdates(pkg) {
  const latestVersion = await fetchLatestVersion(pkg.name);

  if (!latestVersion || !isNewerVersion(latestVersion, pkg.version)) {
    return;
  }

  const updateCmd = `npm install -g ${pkg.name}@latest`;

  console.log();
  console.log(chalk.hex('#FBBF24')('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.hex('#FBBF24')('  │') + chalk.hex('#FBBF24').bold('  🆕 Update available!') + ' '.repeat(28) + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  │') + '                                                  ' + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  │') + `  ${chalk.dim('Current:')} ${chalk.hex('#F87171')(pkg.version)}` + ' '.repeat(Math.max(0, 39 - pkg.version.length)) + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  │') + `  ${chalk.dim('Latest:')}  ${chalk.hex('#34D399').bold(latestVersion)}` + ' '.repeat(Math.max(0, 39 - latestVersion.length)) + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  │') + '                                                  ' + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  │') + `  ${chalk.dim('Run:')} ${chalk.bgHex('#1E293B').hex('#34D399').bold(` ${updateCmd} `)}` + ' '.repeat(Math.max(0, 7)) + chalk.hex('#FBBF24')('│'));
  console.log(chalk.hex('#FBBF24')('  └──────────────────────────────────────────────────┘'));
  console.log();
}
