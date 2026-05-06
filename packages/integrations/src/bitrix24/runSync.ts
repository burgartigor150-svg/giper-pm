import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import { syncUsers, type SyncUsersResult } from './syncUsers';
import { syncProjects, type SyncProjectsResult } from './syncProjects';
import { syncTasks, type SyncTasksResult } from './syncTasks';

export type RunSyncResult = {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  users: SyncUsersResult;
  projects: SyncProjectsResult;
  tasks: SyncTasksResult;
  ok: boolean;
  error?: string;
};

/**
 * One full read-only sync pass. Order matters:
 *   users    — so we can resolve task assignees by bitrix id
 *   projects — so tasks have somewhere to land
 *   tasks    — finally, with `since` watermark for incremental runs
 *
 * Idempotent: re-running with the same data is a no-op (no extra DB writes).
 */
export async function runBitrix24Sync(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: { since?: Date | null; trigger?: 'manual' | 'cron' } = {},
): Promise<RunSyncResult> {
  const startedAt = new Date();

  // Persist a sync log row up front so callers can monitor in-progress runs.
  const integration = await ensureIntegrationRow(prisma);
  const log = await prisma.integrationSyncLog.create({
    data: {
      integrationId: integration.id,
      direction: 'IN',
      status: 'RUNNING',
      startedAt,
    },
  });

  let users: SyncUsersResult = { totalSeen: 0, matched: 0, updated: 0 };
  let projects: SyncProjectsResult = {
    totalSeen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  let tasks: SyncTasksResult = {
    totalSeen: 0,
    created: 0,
    updated: 0,
    skippedNoProject: 0,
    errors: 0,
  };
  let ok = true;
  let error: string | undefined;

  try {
    users = await syncUsers(prisma, client);
    projects = await syncProjects(prisma, client);
    tasks = await syncTasks(prisma, client, { since: opts.since ?? null });
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await prisma.integrationSyncLog.update({
    where: { id: log.id },
    data: {
      finishedAt,
      status: ok ? (tasks.errors > 0 ? 'PARTIAL' : 'SUCCESS') : 'FAILED',
      itemsProcessed: users.totalSeen + projects.totalSeen + tasks.totalSeen,
      errors: error
        ? { fatal: error }
        : tasks.errors > 0
          ? { taskErrors: tasks.errors }
          : undefined,
    },
  });

  return { startedAt, finishedAt, durationMs, users, projects, tasks, ok, error };
}

/**
 * Make sure there's exactly one Integration row for cloud Bitrix24. We use
 * a stable (kind, name) pair so re-runs find the same row.
 */
async function ensureIntegrationRow(prisma: PrismaClient) {
  const NAME = 'cloud';
  const existing = await prisma.integration.findUnique({
    where: { kind_name: { kind: 'BITRIX24', name: NAME } },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.integration.create({
    data: { kind: 'BITRIX24', name: NAME, config: {} },
    select: { id: true },
  });
}

/** Watermark for incremental sync — the latest successful run's startedAt. */
export async function lastSuccessfulSyncStart(prisma: PrismaClient): Promise<Date | null> {
  const log = await prisma.integrationSyncLog.findFirst({
    where: {
      integration: { kind: 'BITRIX24' },
      status: { in: ['SUCCESS', 'PARTIAL'] },
    },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  return log?.startedAt ?? null;
}
