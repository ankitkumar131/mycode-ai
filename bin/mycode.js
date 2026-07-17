#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'packages', 'cli', 'dist', 'mycode.js');

if (!existsSync(cliEntry)) {
  console.error('MyCode CLI not built yet. Run `npm run build` first.');
  process.exit(1);
}

await import(pathToFileURL(cliEntry).href);
