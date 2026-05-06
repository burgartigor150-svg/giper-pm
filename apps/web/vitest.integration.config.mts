import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Integration tests: hit a real test database via Prisma. Sequential to keep
 * truncation determinism (no test pollution between cases).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts', 'lib/**/*.int.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    environment: 'node',
    reporters: ['default'],
    setupFiles: ['./tests/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
