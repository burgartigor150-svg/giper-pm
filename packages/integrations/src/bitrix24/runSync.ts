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

export type RunSyncOptions = {
  since?: Date | null;
  trigger?: 'manual' | 'cron';
  /**
   * Restrict the mirror to one Bitrix24 user — only their workgroups and
   * the tasks where they're either RESPONSIBLE_ID or CREATED_BY. Used for
   * single-user installs (matches the "personal mirror" use-case).
   */
  forBitrixUserId?: string | null;
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
  opts: RunSyncOptions = {},
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

    if (opts.forBitrixUserId) {
      // Personal-mirror path. The user can be a member of N groups but
      // also an accomplice/auditor on tasks in OTHER groups they're not
      // a member of (the "collab" case). Membership-only project sync
      // would silently drop those tasks. Instead, collect every distinct
      // GROUP_ID this user appears in across their MEMBER-tasks, and
      // sync exactly those workgroups.
      const groupIds = await collectMyGroupIds(
        client,
        opts.forBitrixUserId,
        opts.since ?? null,
      );
      projects = await syncProjects(prisma, client, {
        forBitrixUserId: opts.forBitrixUserId,
        extraGroupIds: groupIds,
      });
      tasks = await syncTasks(prisma, client, {
        since: opts.since ?? null,
        forBitrixUserId: opts.forBitrixUserId,
      });
    } else {
      projects = await syncProjects(prisma, client);
      tasks = await syncTasks(prisma, client, { since: opts.since ?? null });
    }
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

/**
 * Walk every task this user appears on (any role: responsible / creator /
 * accomplice / auditor) and return the set of distinct workgroup IDs.
 * Used to seed project sync so personal-mirror runs include groups where
 * the user only watches but doesn't have membership.
 *
 * We pull just the GROUP_ID column so this stays cheap on large portals.
 */
async function collectMyGroupIds(
  client: Bitrix24Client,
  bitrixUserId: string,
  since: Date | null,
): Promise<string[]> {
  const filter: Record<string, unknown> = { MEMBER: bitrixUserId };
  if (since) filter['>=CHANGED_DATE'] = since.toISOString();

  const ids = new Set<string>();
  for await (const page of client.paginate<{ id: string; groupId?: string | null }>(
    'tasks.task.list',
    { filter, select: ['ID', 'GROUP_ID'], order: { ID: 'asc' } },
    'tasks',
  )) {
    for (const t of page) {
      if (t.groupId && t.groupId !== '0') ids.add(t.groupId);
    }
  }
  return [...ids];
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
