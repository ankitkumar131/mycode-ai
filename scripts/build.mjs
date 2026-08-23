#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const currentVersion = rootPkg.version;

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

function syncWorkspaceVersions() {
  for (const pkg of ['core', 'sdk', 'cli', 'a2a-server', 'devtools', 'test-utils']) {
    const pkgPath = join(root, 'packages', pkg, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkgJson.version !== currentVersion) {
          pkgJson.version = currentVersion;
          writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');
        }
      } catch {
        // ignore
      }
    }
  }
}

async function buildPackage(pkg) {
  const pkgDir = join(root, 'packages', pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  console.log(`Building @mycode/${pkg} (v${currentVersion})...`);

  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.peerDependencies,
  };

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
    define: {
      'process.env.CLI_VERSION': JSON.stringify(currentVersion),
    },
  };

  try {
    await esbuild.build({
      ...sharedOpts,
      entryPoints: [join(pkgDir, 'src', 'index.ts')],
      outfile: join(pkgDir, 'dist', 'index.js'),
      bundle: true,
    });

    const binEntry = join(pkgDir, 'src', 'mycode.ts');
    if (existsSync(binEntry)) {
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

      const jsOut = join(pkgDir, 'dist', 'mycode.js');
      const jsContent = readFileSync(jsOut, 'utf-8');
      writeFileSync(jsOut, '#!/usr/bin/env node\n' + jsContent.replace(/^#!.*\n/, ''));
    }

    if (pkg === 'cli') {
      const standaloneOut = join(pkgDir, 'dist', 'mycode-standalone.cjs');
      try {
        await esbuild.build({
          entryPoints: [binEntry],
          outfile: standaloneOut,
          bundle: true,
          platform: 'node',
          target: 'node20',
          format: 'cjs',
          external: NODE_BUILTINS,
          tsconfig: join(pkgDir, 'tsconfig.json'),
          logLevel: 'info',
          define: {
            'process.env.CLI_VERSION': JSON.stringify(currentVersion),
          },
        });
        const content = readFileSync(standaloneOut, 'utf-8');
        writeFileSync(standaloneOut, '#!/usr/bin/env node\n' + content.replace(/^#!.*\n/, ''));
        console.log(`  ✓ @mycode/${pkg} standalone bundle built (v${currentVersion})`);
      } catch (err) {
        console.error(`  ✖ @mycode/${pkg} standalone bundle failed:`, err.message);
        process.exitCode = 1;
      }
    }

    console.log(`  ✓ @mycode/${pkg} built successfully`);
  } catch (err) {
    console.error(`  ✖ @mycode/${pkg} build failed:`, err.message);
    process.exitCode = 1;
  }
}

async function main() {
  syncWorkspaceVersions();
  for (const pkg of packages) {
    await buildPackage(pkg);
  }
}

main();
