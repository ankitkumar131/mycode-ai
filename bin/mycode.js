#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prefer standalone bundle (self-contained), fall back to workspace-linked ESM build
const standaloneEntry = join(__dirname, '..', 'packages', 'cli', 'dist', 'mycode-standalone.cjs');
const workspaceEntry = join(__dirname, '..', 'packages', 'cli', 'dist', 'mycode.js');

if (existsSync(standaloneEntry)) {
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
