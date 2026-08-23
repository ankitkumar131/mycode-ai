import { rmSync } from 'fs';
import { join } from 'path';

const pkgs = ['cli', 'core', 'sdk', 'a2a-server', 'devtools', 'test-utils'];

for (const pkg of pkgs) {
  rmSync(join(process.cwd(), 'packages', pkg, 'dist'), { recursive: true, force: true });
}

console.log('✓ Cleaned dist folders');
