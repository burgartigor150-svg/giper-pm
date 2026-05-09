import { Bitrix24Client, runBitrix24Sync, lastSuccessfulSyncStart } from '@giper/integrations/bitrix24';
import { prisma } from '@giper/db';
import { DomainError } from '../errors';

/** Single source of truth for the cloud Bitrix24 webhook URL. */
function webhookUrl(): string {
  const url = process.env.BITRIX24_WEBHOOK_URL?.trim();
  if (!url) {
    throw new DomainError(
      'VALIDATION',
      400,
      'BITRIX24_WEBHOOK_URL is not configured. Add it to .env.local and restart the server.',
    );
  }
  return url;
}

export function getBitrix24Client(): Bitrix24Client {
  return new Bitrix24Client({ webhookUrl: webhookUrl() });
}

/**
 * Run a read-only sync. Pulls users, projects, tasks.
 *
 * Default scope: every active local user with a bitrixUserId set —
 * iterates per user with the same MEMBER-scoped logic as the legacy
 * single-admin path. This catches dev-team tasks that don't have the
 * admin on them. Closed (DONE/CANCELED) tasks are filtered out at the
 * Bitrix-list level (see syncTasks) so the volume stays sane.
 *
 * Window: on the first run (no prior successful log) we cap the task
 * fetch to the last 30 days. Subsequent runs go incremental from the
 * previous successful start.
 *
 * Pass `mineOnly: true` for the legacy "first ADMIN only" behaviour
 * (single-admin / personal-mirror installs). `mineOnly: false` does
 * the same per-user iteration described above.
 */
export async function runBitrix24SyncNow(
  opts: { force?: boolean; mineOnly?: boolean } = {},
) {
  const client = getBitrix24Client();
  const last = await lastSuccessfulSyncStart(prisma);
  const since = opts.force
    ? null
    : last ?? new Date(Date.now() - 30 * 24 * 3600_000);

  // Comma-separated allowlist of Bitrix department ids whose members
  // are auto-activated on every sync. Empty/unset → no auto-activation.
  const activeDepartmentIds = (process.env.BITRIX24_ACTIVE_DEPARTMENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (opts.mineOnly === true) {
    // Legacy single-admin path — kept for parity. Used by the
    // personal-mirror install where only the admin's tasks matter.
    return runForAdmin(client, since, activeDepartmentIds);
  }

  // Default: aggregate sync over every active linked user. Always run
  // syncUsers first (no scope) so newly created people land before
  // their tasks try to resolve assignees.
  const bootstrap = await runBitrix24Sync(prisma, client, {
    since,
    forBitrixUserId: '__bootstrap__',
    createMissingUsers: true,
    activeDepartmentIds,
  });

  const linkedUsers = await prisma.user.findMany({
    where: { bitrixUserId: { not: null }, isActive: true },
    select: { id: true, name: true, bitrixUserId: true },
  });
  if (linkedUsers.length === 0) {
    return bootstrap;
  }

  // Aggregate counters across per-user passes.
  const agg = freshAggregate();
  for (const u of linkedUsers) {
    if (!u.bitrixUserId) continue;
    const r = await runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: u.bitrixUserId,
      createMissingUsers: false, // already done in bootstrap
      activeDepartmentIds,
    });
    addInto(agg, r);
  }
  // Carry the bootstrap users summary so callers see them counted.
  agg.users = bootstrap.users;
  agg.finishedAt = new Date();
  agg.durationMs = agg.finishedAt.getTime() - agg.startedAt.getTime();
  return agg;
}

async function runForAdmin(
  client: ReturnType<typeof getBitrix24Client>,
  since: Date | null,
  activeDepartmentIds: string[],
) {
  let me = await findLinkedAdmin();
  if (!me?.bitrixUserId) {
    await runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: '__bootstrap__',
      createMissingUsers: true,
      activeDepartmentIds,
    });
    me = await findLinkedAdmin();
  }
  if (me?.bitrixUserId) {
    return runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: me.bitrixUserId,
      createMissingUsers: true,
      activeDepartmentIds,
    });
  }
  return runBitrix24Sync(prisma, client, {
    since,
    forBitrixUserId: '__bootstrap__',
    createMissingUsers: true,
    activeDepartmentIds,
  });
}

function freshAggregate() {
  const startedAt = new Date();
  return {
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    ok: true,
    error: undefined as string | undefined,
    users: { totalSeen: 0, matched: 0, updated: 0, created: 0 },
    projects: { totalSeen: 0, created: 0, updated: 0, skipped: 0 },
    tasks: {
      totalSeen: 0,
      created: 0,
      updated: 0,
      skippedNoProject: 0,
      errors: 0,
      files: { totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0 },
      comments: { totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0 },
      history: { totalSeen: 0, created: 0, updated: 0, errors: 0 },
    },
  };
}

function addInto(
  agg: ReturnType<typeof freshAggregate>,
  r: Awaited<ReturnType<typeof runBitrix24Sync>>,
) {
  if (!r.ok) {
    agg.ok = false;
    agg.error = r.error ?? agg.error;
  }
  agg.projects.totalSeen += r.projects.totalSeen;
  agg.projects.created += r.projects.created;
  agg.projects.updated += r.projects.updated;
  agg.projects.skipped += r.projects.skipped;
  agg.tasks.totalSeen += r.tasks.totalSeen;
  agg.tasks.created += r.tasks.created;
  agg.tasks.updated += r.tasks.updated;
  agg.tasks.skippedNoProject += r.tasks.skippedNoProject;
  agg.tasks.errors += r.tasks.errors;
  for (const k of ['totalSeen', 'created', 'updated', 'deleted', 'errors'] as const) {
    agg.tasks.files[k] += r.tasks.files[k];
    agg.tasks.comments[k] += r.tasks.comments[k];
  }
  for (const k of ['totalSeen', 'created', 'updated', 'errors'] as const) {
    agg.tasks.history[k] += r.tasks.history[k];
  }
}

/**
 * Sync every member of a PM's roster from Bitrix24 in one pass. Each
 * member is synced with their own `forBitrixUserId` scope so we pull
 * only their tasks, not the whole portal. The PM themselves is also
 * included — they're effectively the "lead" of their team.
 *
 * Returns per-member stats so the UI can surface "Глеб: 12 tasks
 * created, 3 updated" feedback.
 */
export async function runBitrix24TeamSyncNow(
  pmId: string,
  opts: { force?: boolean } = {},
): Promise<
  | { ok: true; perMember: Array<{ memberId: string; name: string; created: number; updated: number; comments: number }> }
  | { ok: false; error: string }
> {
  const client = getBitrix24Client();
  const last = await lastSuccessfulSyncStart(prisma);
  const since = opts.force
    ? null
    : last ?? new Date(Date.now() - 30 * 24 * 3600_000);
  const activeDepartmentIds = (process.env.BITRIX24_ACTIVE_DEPARTMENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Pull the PM's team plus the PM themselves. Members without a
  // bitrixUserId are skipped — sync needs the upstream id to scope.
  const team = await prisma.pmTeamMember.findMany({
    where: { pmId },
    select: {
      member: {
        select: { id: true, name: true, bitrixUserId: true },
      },
    },
  });
  const pm = await prisma.user.findUnique({
    where: { id: pmId },
    select: { id: true, name: true, bitrixUserId: true },
  });
  if (!pm) return { ok: false, error: 'PM не найден' };

  const targets = [
    pm,
    ...team
      .map((t) => t.member)
      .filter((m) => m.bitrixUserId && m.id !== pm.id),
  ].filter((u) => u.bitrixUserId);

  if (targets.length === 0) {
    return { ok: false, error: 'Никто из команды не связан с Bitrix24' };
  }

  const perMember: Array<{
    memberId: string;
    name: string;
    created: number;
    updated: number;
    comments: number;
  }> = [];
  for (const u of targets) {
    if (!u.bitrixUserId) continue;
    const r = await runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: u.bitrixUserId,
      createMissingUsers: true,
      activeDepartmentIds,
    });
    perMember.push({
      memberId: u.id,
      name: u.name,
      created: r.tasks.created,
      updated: r.tasks.updated,
      comments: r.tasks.comments.created,
    });
  }
  return { ok: true, perMember };
}

async function findLinkedAdmin() {
  return prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true, bitrixUserId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { bitrixUserId: true },
  });
}

export async function getBitrix24SyncStatus() {
  const integration = await prisma.integration.findUnique({
    where: { kind_name: { kind: 'BITRIX24', name: 'cloud' } },
    select: { id: true, isActive: true, createdAt: true },
  });
  if (!integration) {
    return { configured: !!process.env.BITRIX24_WEBHOOK_URL, integration: null, lastRuns: [] };
  }
  const lastRuns = await prisma.integrationSyncLog.findMany({
    where: { integrationId: integration.id },
    orderBy: { startedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      direction: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      itemsProcessed: true,
      errors: true,
    },
  });
  return { configured: !!process.env.BITRIX24_WEBHOOK_URL, integration, lastRuns };
}
