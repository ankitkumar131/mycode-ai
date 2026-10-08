import { rmSync } from 'fs';
import { join } from 'path';

const pkgs = ['cli', 'core', 'sdk'];

for (const pkg of pkgs) {
  rmSync(join(process.cwd(), 'packages', pkg, 'dist'), { recursive: true, force: true });
}

console.log('✓ Cleaned dist folders');
