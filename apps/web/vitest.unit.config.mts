import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Unit tests: pure logic, no DB, no Next.js. Fast.
 * Currently empty by default — most pure logic lives in @giper/shared.
 * apps/web units (e.g. format helpers) go here when needed.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['lib/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['lib/**/*.int.test.ts', 'node_modules/**', '.next/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
