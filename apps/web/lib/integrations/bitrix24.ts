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
 * Run a full read-only sync. Pulls users, projects, tasks.
 *
 * Scope: by default we mirror only data tied to the first ADMIN user — i.e.
 * the workgroups they're a member of and the tasks where they're either
 * RESPONSIBLE_ID or CREATED_BY. This matches the "personal mirror" use-case;
 * pass `mineOnly: false` to mirror everything visible to the webhook user.
 *
 * Window: on the first run (no prior successful log) we cap the task fetch
 * to the last 30 days to keep the initial pass fast on portals with tens
 * of thousands of historical tasks. Subsequent runs go incremental from
 * the previous successful start.
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

  // Resolve "me" = first admin's bitrixUserId. The personal mirror
  // requires this link to know what to scope to. On the very first run
  // it isn't there yet — syncUsers (run first inside runBitrix24Sync)
  // will populate it by matching emails. To keep the first pass scoped
  // and not accidentally pull the entire portal, we run sync twice when
  // the link isn't yet established: first to match users, then a second
  // scoped sync. Both calls are cheap because empty.
  if (opts.mineOnly !== false) {
    let me = await findLinkedAdmin();
    if (!me?.bitrixUserId) {
      // Run a "users-only" pass: temporarily scope to a non-existent id
      // so projects+tasks return nothing, then re-resolve.
      await runBitrix24Sync(prisma, client, {
        since,
        forBitrixUserId: '__bootstrap__', // any non-empty string nobody owns
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
    // Still not linked — emails don't match. Surface a no-op so the UI
    // can show a clear "set up user mapping" message instead of silently
    // dumping the whole portal.
    return runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: '__bootstrap__',
      createMissingUsers: true,
      activeDepartmentIds,
    });
  }

  return runBitrix24Sync(prisma, client, {
    since,
    createMissingUsers: true,
    activeDepartmentIds,
  });
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
