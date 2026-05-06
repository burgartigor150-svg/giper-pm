import type { PrismaClient } from '@giper/db';

/**
 * Truncate every table that the suite writes to. Order matters because of
 * FK relations; use CASCADE for safety against accidental ordering bugs.
 *
 * Per CONVENTIONS.md: TRUNCATE is faster than drop/recreate between cases.
 */
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

export async function resetDb(prisma: PrismaClient): Promise<void> {
  // One TRUNCATE statement is faster than many — CASCADE handles FKs.
  const list = TABLES.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}
