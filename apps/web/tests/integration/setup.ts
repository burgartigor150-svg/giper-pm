import { beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * Force the integration suite to use the test database.
 * Set BEFORE any module imports prisma — vitest setup files load first.
 */
const TEST_DB = 'postgresql://giper:giper@localhost:5433/giper_pm_test';

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('5433')) {
  process.env.DATABASE_URL = TEST_DB;
}

// Lazy import so DATABASE_URL is set first.
const { prisma } = await import('@giper/db');
const { resetDb } = await import('./helpers/reset');

beforeAll(async () => {
  // Sanity guard against accidentally pointing at the dev DB.
  if (!process.env.DATABASE_URL?.includes('5433')) {
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
