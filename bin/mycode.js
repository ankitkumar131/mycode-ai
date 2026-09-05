#!/usr/bin/env node
process.noDeprecation = true;

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, statSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Auto-rebuild when sources are newer than the bundle (dist/ is git-ignored,
// so `git pull` alone leaves a stale build behind).
function newestMtime(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(ts|tsx|mjs|json)$/.test(e.name)) {
        try { newest = Math.max(newest, statSync(p).mtimeMs); } catch {}
      }
    }
  }
  return newest;
}

function ensureFreshBuild(bundle) {
  if (process.env.MYCODE_SKIP_BUILD_CHECK) return;
  const srcDir = join(root, 'packages');
  if (!existsSync(srcDir) || !existsSync(join(root, 'scripts', 'build.mjs'))) return;
  let bundleTime = 0;
  try { bundleTime = statSync(bundle).mtimeMs; } catch {}
  if (newestMtime(srcDir) <= bundleTime) return;
  console.error('  ⟳ Sources changed since the last build — rebuilding MyCode…');
  try {
    execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('  Build failed; running the existing (stale) bundle.');
  }
}

// Prefer standalone bundle (self-contained), fall back to workspace-linked ESM build
const standaloneEntry = join(__dirname, '..', 'packages', 'cli', 'dist', 'mycode-standalone.cjs');
const workspaceEntry = join(__dirname, '..', 'packages', 'cli', 'dist', 'mycode.js');

if (existsSync(standaloneEntry)) {
  ensureFreshBuild(standaloneEntry);
  await import(pathToFileURL(standaloneEntry).href);
} else if (existsSync(workspaceEntry)) {
  try {
    await import(pathToFileURL(workspaceEntry).href);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('\nError: MyCode workspace modules could not be resolved.');
      console.error('If you are running MyCode globally, please build the project first:');
      console.error('  npm run build');
      console.error('And then install/link it again. The standalone bundle must be present at:');
      console.error(`  ${standaloneEntry}\n`);
      process.exit(1);
    }
    throw err;
  }
} else {
  console.error('MyCode CLI not built yet. Run `npm run build` first.');
  process.exit(1);
}
