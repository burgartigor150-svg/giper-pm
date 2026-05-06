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
      });
      me = await findLinkedAdmin();
    }
    if (me?.bitrixUserId) {
      return runBitrix24Sync(prisma, client, {
        since,
        forBitrixUserId: me.bitrixUserId,
      });
    }
    // Still not linked — emails don't match. Surface a no-op so the UI
    // can show a clear "set up user mapping" message instead of silently
    // dumping the whole portal.
    return runBitrix24Sync(prisma, client, {
      since,
      forBitrixUserId: '__bootstrap__',
    });
  }

  return runBitrix24Sync(prisma, client, { since });
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
