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

  // Resolve "me" = first admin's bitrixUserId. If they aren't yet linked
  // to a Bitrix24 user (sync hasn't run yet, or emails don't match), fall
  // back to the global mirror so we still pull data on the very first pass
  // — syncUsers runs first and will fix the link before tasks are fetched.
  let forBitrixUserId: string | null = null;
  if (opts.mineOnly !== false) {
    const me = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true, bitrixUserId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { bitrixUserId: true },
    });
    forBitrixUserId = me?.bitrixUserId ?? null;
  }

  return runBitrix24Sync(prisma, client, { since, forBitrixUserId });
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
