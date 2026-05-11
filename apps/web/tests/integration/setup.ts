import { beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * Force the integration suite to use the test database.
 * Set BEFORE any module imports prisma — vitest setup files load first.
 *
 * Env override TEST_DATABASE_URL lets the developer point at an alt
 * test DB (e.g. when port 5433 is hijacked by an unrelated process —
 * Cursor's extension host on macOS does this for some workspaces).
 * The URL must contain "test" somewhere so the safety guard below
 * still applies.
 */
const TEST_DB =
  process.env.TEST_DATABASE_URL ||
  'postgresql://giper:giper@localhost:5433/giper_pm_test';

if (!process.env.DATABASE_URL || !/test/i.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = TEST_DB;
}

// Lazy import so DATABASE_URL is set first.
const { prisma } = await import('@giper/db');
const { resetDb } = await import('./helpers/reset');

beforeAll(async () => {
  // Sanity guard against accidentally pointing at the dev DB.
  // Match by database name containing "test", not by port — the
  // override path may use any port.
  if (!/test/i.test(process.env.DATABASE_URL ?? '')) {
    throw new Error(
      `Refusing to run integration suite against non-test DB: ${process.env.DATABASE_URL}`,
    );
  }
});

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});
