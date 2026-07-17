import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@mycode/core': path.resolve(__dirname, 'packages/core/src'),
      '@mycode/sdk': path.resolve(__dirname, 'packages/sdk/src'),
      '@mycode/cli': path.resolve(__dirname, 'packages/cli/src'),
    },
  },
});
