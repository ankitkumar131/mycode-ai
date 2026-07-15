import { renderBox } from '../ui/renderer.js';

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

  renderBox(
    'Update available',
    [
      `Current version: ${pkg.version}`,
      `Latest version:  ${latestVersion}`,
      '',
      'Update with:',
      `npm install -g ${pkg.name}@latest`,
    ].join('\n'),
    '#FBBF24'
  );
}
