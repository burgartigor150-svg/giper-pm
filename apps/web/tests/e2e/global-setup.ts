import { chromium, type FullConfig } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@giper/db';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const TEST_DB = 'postgresql://giper:giper@localhost:5433/giper_pm_test';

const TABLES = [
  'AuditLog',
  'Notification',
  'Comment',
  'Attachment',
  'TaskStatusChange',
  'TimeEntry',
  'Activity',
  'Screenshot',
  'AgentDevice',
  'UserConsent',
  'UserIntegrationLink',
  'IntegrationSyncLog',
  'ProjectIntegration',
  'Integration',
  'Task',
  'ProjectMember',
  'Project',
  'Session',
  'Account',
  'VerificationToken',
  'User',
];

export default async function globalSetup(config: FullConfig) {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB } },
  });
  const list = TABLES.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
  );

  const hash = await bcrypt.hash('admin-pass-1', 4);
  await prisma.user.create({
    data: {
      email: 'admin@e2e.test',
      name: 'Admin E2E',
      role: 'ADMIN',
      passwordHash: hash,
      mustChangePassword: false,
      isActive: true,
    },
  });
  await prisma.$disconnect();

  // Ensure storage dir exists.
  const authDir = path.resolve(__dirname, '.auth');
  mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  await page.goto(`${baseURL}/login`);
  await page.fill('input[name="email"]', 'admin@e2e.test');
  await page.fill('input[name="password"]', 'admin-pass-1');
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await ctx.storageState({ path: path.join(authDir, 'admin.json') });
  await browser.close();
}
