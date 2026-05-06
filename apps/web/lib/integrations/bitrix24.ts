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
 * Run a full read-only sync. Pulls users, projects, tasks. On the first run
 * (no prior successful log) we cap the task fetch to the last 30 days to
 * keep the initial pass under a few minutes for portals with tens of
 * thousands of historical tasks; subsequent runs go incremental from the
 * previous successful start.
 */
export async function runBitrix24SyncNow(opts: { force?: boolean } = {}) {
  const client = getBitrix24Client();
  const last = await lastSuccessfulSyncStart(prisma);
  const since = opts.force
    ? null
    : last ?? new Date(Date.now() - 30 * 24 * 3600_000);
  return runBitrix24Sync(prisma, client, { since });
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
