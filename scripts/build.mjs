#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
const pkgIndex = args.indexOf('--package');
const targetPackage = pkgIndex !== -1 ? args[pkgIndex + 1] : null;

const packages = targetPackage ? [targetPackage] : ['core', 'sdk', 'cli', 'a2a-server', 'devtools', 'test-utils'];

const NODE_BUILTINS = [
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns',
  'dns/promises', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'path/posix',
  'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'readline/promises', 'repl', 'stream', 'stream/consumers',
  'stream/promises', 'stream/web', 'string_decoder', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util',
  'util/types', 'v8', 'vm', 'worker_threads', 'zlib',
];

async function buildPackage(pkg) {
  const pkgDir = join(root, 'packages', pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  console.log(`Building @mycode/${pkg}...`);

  // Build configuration
  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.peerDependencies,
  };

  // Filter out @mycode/* workspace deps (they'll be resolved via node_modules after install)
  const externalDeps = Object.keys(allDeps || {}).filter(
    (d) => !d.startsWith('@mycode/'),
  );

  const external = [...NODE_BUILTINS, ...externalDeps];

  const sharedOpts = {
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    external,
    tsconfig: join(pkgDir, 'tsconfig.json'),
    logLevel: 'info',
  };

  try {
    await esbuild.build({
      ...sharedOpts,
      entryPoints: [join(pkgDir, 'src', 'index.ts')],
      outfile: join(pkgDir, 'dist', 'index.js'),
      bundle: true,
    });

    // Also build the CLI binary entry point if it exists
    const binEntry = join(pkgDir, 'src', 'mycode.ts');
    if (existsSync(binEntry)) {
      // For CLI binary: transpile only (no bundle), use ESM, externalize everything
      const binExternal = [...Object.keys(allDeps || {}).filter(d => d.startsWith('@mycode/')), ...NODE_BUILTINS, ...externalDeps];
      await esbuild.build({
        ...sharedOpts,
        entryPoints: [binEntry],
        outfile: join(pkgDir, 'dist', 'mycode.js'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        external: binExternal,
      });

      // Ensure single shebang
      const jsOut = join(pkgDir, 'dist', 'mycode.js');
      const jsContent = readFileSync(jsOut, 'utf-8');
      writeFileSync(jsOut, '#!/usr/bin/env node\n' + jsContent.replace(/^#!.*\n/, ''));
    }

    console.log(`  \u2713 @mycode/${pkg} built successfully`);
  } catch (err) {
    console.error(`  \u2717 @mycode/${pkg} build failed:`, err.message);
    process.exitCode = 1;
  }
}

async function main() {
  for (const pkg of packages) {
    await buildPackage(pkg);
  }
}

main();
