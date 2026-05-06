import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Integration tests share a single Postgres database. We force everything to
 * run in one process via `pool: 'forks'` + `singleFork: true` so the per-test
 * TRUNCATE in setup.ts never races a concurrent test in another worker.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts', 'lib/**/*.int.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    environment: 'node',
    reporters: ['default'],
    setupFiles: ['./tests/integration/setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
