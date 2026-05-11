import type { PrismaClient } from '@giper/db';

/**
 * Wipe every table that the suite writes to, in FK-safe order.
 *
 * Earlier we used `TRUNCATE ... CASCADE`, but that takes
 * `AccessExclusiveLock` on every named table at once and can deadlock
 * with concurrent in-flight Prisma queries from prior test fixtures
 * (`40P01`). DELETE only takes row-level locks per table and we walk
 * the dependency graph in a deterministic, leaves-first order.
 *
 * Sequence resetting isn't needed — every model uses cuid().
 */
const TABLES_IN_DELETE_ORDER = [
  // Leaves first (no incoming FKs that matter).
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
  // Messenger graph (Reaction → Mention → Attachment → Message → Member → Channel).
  'MessageReaction',
  'MessageMention',
  'MessageAttachment',
  'Message',
  'ChannelMember',
  'Channel',
  // Meetings graph.
  'MeetingTranscript',
  'MeetingParticipant',
  'Meeting',
  // Telegram glue.
  'TelegramProjectMessage',
  'ProjectTelegramChat',
  'UserTelegramBot',
  // Task graph (assignments / tags / deps / watchers / PR-links / checklists).
  'TaskAssignment',
  'TaskTag',
  'Tag',
  'TaskDependency',
  'TaskWatcher',
  'TaskPullRequest',
  'ChecklistItem',
  'Checklist',
  // Task references Project + User.
  'Task',
  'ProjectMember',
  'ProjectBitrixMember',
  'Project',
  // PM/team graph.
  'PmTeamMember',
  'UserPosition',
  // Auth tables reference User.
  'Session',
  'Account',
  'VerificationToken',
  // User last.
  'User',
];

export async function resetDb(prisma: PrismaClient): Promise<void> {
  for (const table of TABLES_IN_DELETE_ORDER) {
    await prisma.$executeRawUnsafe(`DELETE FROM "public"."${table}";`);
  }
}
