import { prisma } from '@giper/db';
import { syncCollabChat, pushCollabChatMessage, type SyncCollabChatResult } from '@giper/integrations/bitrix24';
import { getBitrix24Client } from '@/lib/integrations/bitrix24';

/**
 * Mirror every Bitrix-mirrored project's collab group chat into a per-project
 * messenger Channel. Runs from the cron. Best-effort per project — one failure
 * never aborts the rest.
 */
export async function runCollabChatSync(opts?: { signal?: AbortSignal }): Promise<{
  projects: number;
  messages: number;
  created: number;
  errors: number;
  truncated: number;
}> {
  const client = getBitrix24Client();
  const projects = await prisma.project.findMany({
    where: { externalSource: 'bitrix24', externalId: { not: null } },
    select: { id: true, externalId: true, name: true },
  });
  const stats: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
  let seen = 0;
  for (const p of projects) {
    if (opts?.signal?.aborted) break;
    if (!p.externalId) continue;
    seen++;
    try {
      await syncCollabChat(prisma, client, { id: p.id, externalId: p.externalId, name: p.name }, stats, opts?.signal);
    } catch (e) {
      stats.errors++;
      console.error('bitrix collab chat sync failed for project', p.id, e);
    }
  }
  return { projects: seen, messages: stats.messages, created: stats.created, errors: stats.errors, truncated: stats.truncated };
}

/**
 * Best-effort outbound: mirror a giper-pm messenger message posted in a collab's
 * group-chat Channel into the Bitrix24 collab chat. Fire-and-forget from
 * postMessageAction — a Bitrix outage or a non-collab channel must never block
 * or fail the user's send. The underlying push self-filters (wrong slug,
 * already-mirrored, non-bitrix project) so calling it for every message is safe.
 */
export async function pushCollabChatMessageBestEffort(messageId: string): Promise<void> {
  try {
    if (!process.env.BITRIX24_WEBHOOK_URL?.trim()) return;
    const client = getBitrix24Client();
    await pushCollabChatMessage(prisma, client, messageId);
  } catch (e) {
    console.warn('[messenger] collab chat outbound push failed:', e);
  }
}
