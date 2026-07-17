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

async function buildPackage(pkg) {
  const pkgDir = join(root, 'packages', pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  console.log(`Building @mycode/${pkg}...`);

  const entryPoints = [];

  // Find all .ts and .tsx entry points
  const srcDir = join(pkgDir, 'src');
  if (existsSync(srcDir)) {
    // Always include index.ts as main entry if it exists
    const mainEntry = join(srcDir, 'index.ts');
    if (existsSync(mainEntry)) {
      entryPoints.push(mainEntry);
    } else {
      // Fallback: use the directory itself
      entryPoints.push(join(srcDir, 'index.ts'));
    }
  }

  // Build configuration
  const external = [
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {}),
  ];

  // Handle workspace references
  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.peerDependencies,
  };

  // Filter out @mycode/* workspace deps (they'll be resolved via node_modules after install)
  const externalDeps = Object.keys(allDeps || {}).filter(
    (d) => !d.startsWith('@mycode/'),
  );

  try {
    await esbuild.build({
      entryPoints: [join(pkgDir, 'src', 'index.ts')],
      outfile: join(pkgDir, 'dist', 'index.js'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      sourcemap: true,
      external: externalDeps,
      tsconfig: join(pkgDir, 'tsconfig.json'),
      logLevel: 'info',
    });

    // Also build the CLI binary entry point if it exists
    const binEntry = join(pkgDir, 'src', 'mycode.ts');
    if (existsSync(binEntry)) {
      await esbuild.build({
        entryPoints: [binEntry],
        outfile: join(pkgDir, 'dist', 'mycode.js'),
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        sourcemap: true,
        external: externalDeps,
        tsconfig: join(pkgDir, 'tsconfig.json'),
        banner: {
          js: '#!/usr/bin/env node',
        },
        logLevel: 'info',
      });

      // Make it executable (on Unix) - on Windows we rely on the shebang
      try {
        const outfile = join(pkgDir, 'dist', 'mycode.js');
        const content = readFileSync(outfile, 'utf-8');
        if (!content.startsWith('#!/usr/bin/env node')) {
          writeFileSync(outfile, '#!/usr/bin/env node\n' + content);
        }
      } catch {
        // ignore on Windows
      }
    }

    console.log(`✓ @mycode/${pkg} built successfully`);
  } catch (err) {
    console.error(`✗ @mycode/${pkg} build failed:`, err.message);
    process.exitCode = 1;
  }
}

async function main() {
  for (const pkg of packages) {
    await buildPackage(pkg);
  }
}

main();
