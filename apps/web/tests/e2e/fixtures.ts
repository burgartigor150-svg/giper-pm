import { PrismaClient } from '@giper/db';
import bcrypt from 'bcryptjs';
import type { Page, BrowserContext } from '@playwright/test';

export const TEST_DB = 'postgresql://giper:giper@localhost:5433/giper_pm_test';

let _prisma: PrismaClient | null = null;
export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  }
  return _prisma;
}

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

/** Wipe all tables. Use in beforeAll per file. */
export async function resetDb(): Promise<void> {
  const prisma = getPrisma();
  const list = TABLES.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
  );
}

export const ADMIN_EMAIL = 'admin@e2e.test';
export const ADMIN_PASS = 'admin-pass-1';
/**
 * Deterministic id for the admin. The JWT cookie persists across truncate +
 * re-seed, so keeping the id stable means the session remains valid for
 * already-logged-in admin pages.
 */
export const ADMIN_ID = 'admin-e2e-stable-id';

export type SeededUser = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER';
  password: string;
};

export async function seedAdmin(): Promise<SeededUser> {
  const prisma = getPrisma();
  const password = ADMIN_PASS;
  const hash = await bcrypt.hash(password, 4);
  const u = await prisma.user.upsert({
    where: { id: ADMIN_ID },
    create: {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      name: 'Admin E2E',
      role: 'ADMIN',
      passwordHash: hash,
      mustChangePassword: false,
      isActive: true,
    },
    update: {
      email: ADMIN_EMAIL,
      name: 'Admin E2E',
      role: 'ADMIN',
      passwordHash: hash,
      mustChangePassword: false,
      isActive: true,
    },
  });
  return { id: u.id, email: u.email, name: u.name, role: 'ADMIN', password };
}

export async function seedUser(opts: {
  email: string;
  name?: string;
  role?: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER';
  password?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
}): Promise<SeededUser> {
  const prisma = getPrisma();
  const password = opts.password ?? 'pass-1234';
  const hash = await bcrypt.hash(password, 4);
  const u = await prisma.user.upsert({
    where: { email: opts.email },
    create: {
      email: opts.email,
      name: opts.name ?? opts.email.split('@')[0]!,
      role: opts.role ?? 'MEMBER',
      passwordHash: hash,
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
    },
    update: {
      name: opts.name ?? opts.email.split('@')[0]!,
      role: opts.role ?? 'MEMBER',
      passwordHash: hash,
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
    },
  });
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: (opts.role ?? 'MEMBER') as SeededUser['role'],
    password,
  };
}

export async function seedProject(opts: {
  key: string;
  name?: string;
  ownerId: string;
}): Promise<{ id: string; key: string; name: string }> {
  const prisma = getPrisma();
  const p = await prisma.project.create({
    data: {
      key: opts.key,
      name: opts.name ?? `Project ${opts.key}`,
      ownerId: opts.ownerId,
      members: {
        create: { userId: opts.ownerId, role: 'LEAD' },
      },
    },
  });
  return { id: p.id, key: p.key, name: p.name };
}

export async function seedTask(opts: {
  projectId: string;
  creatorId: string;
  title?: string;
  status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';
  assigneeId?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  number?: number;
}): Promise<{
  id: string;
  number: number;
  title: string;
  status: string;
}> {
  const prisma = getPrisma();
  const max = await prisma.task.aggregate({
    where: { projectId: opts.projectId },
    _max: { number: true },
  });
  const number = opts.number ?? (max._max.number ?? 0) + 1;
  const t = await prisma.task.create({
    data: {
      projectId: opts.projectId,
      number,
      title: opts.title ?? `Task ${number}`,
      creatorId: opts.creatorId,
      assigneeId: opts.assigneeId ?? null,
      status: opts.status ?? 'TODO',
      priority: opts.priority ?? 'MEDIUM',
    },
  });
  return { id: t.id, number: t.number, title: t.title, status: t.status };
}

/** Log out admin (clear cookies) and sign in as the given user via UI. */
export async function loginAs(
  page: Page,
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  await context.clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}
