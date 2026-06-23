import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import { convertBitrixMarkup } from './mappers';
import { getBitrixBotUserId } from './botUser';

/**
 * Mirror a Bitrix24 collab's OWN group chat (the space-level conversation, not a
 * task discussion) into a giper-pm messenger Channel. A collab is a sonet group
 * (already mirrored as a Project); its group chat is reachable at
 * `DIALOG_ID = sg<groupId>` via im.dialog.messages.get — derived from
 * Project.externalId, no chat-id lookup needed.
 *
 * The channel is PRIVATE (a collab can hold guests + client-facing talk — never
 * expose it org-wide); its members are the project's members plus the mapped
 * authors who actually post. Each message → Message row, deduped + race-safe via
 * upsert on externalId=`bxchat:<msgId>`. Author resolves by bitrixUserId; system
 * messages (author 0) / unmatched senders use the inert Bitrix bot + source SYSTEM.
 *
 * Incremental: we only pull messages newer than the highest id already mirrored
 * into the channel, so a re-run on a quiet chat costs ~1 API call, not the whole
 * history. The first run backfills up to MAX_PAGES*PAGE_LIMIT messages.
 */

const CHANNEL_SLUG = 'bitrix-collab';
const PAGE_LIMIT = 50;
const MAX_PAGES = 200;

export type SyncCollabChatResult = { messages: number; created: number; errors: number; truncated: number };

type BxMessage = { id: number | string; date?: string; author_id: number | string; text?: string };

function parseBxChatId(externalId: string | null): number {
  if (!externalId) return 0;
  const n = Number(externalId.replace(/^bxchat:/, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function syncCollabChat(
  prisma: PrismaClient,
  client: Bitrix24Client,
  project: { id: string; externalId: string; name: string },
  stats: SyncCollabChatResult,
  signal?: AbortSignal,
): Promise<void> {
  const botId = await getBitrixBotUserId(prisma);

  // Don't create a channel yet: the webhook owner isn't a member of every
  // collab's chat, and a 403 on pull must not leave an empty orphan channel
  // behind. Look one up if it exists — we materialize only after a readable
  // pull (step 2 below).
  const existing = await prisma.channel.findUnique({
    where: { projectId_slug: { projectId: project.id, slug: CHANNEL_SLUG } },
    select: { id: true },
  });

  // High-water mark: only fetch messages newer than what we already mirrored
  // (0 when no channel exists yet → the first run backfills the history).
  let highWater = 0;
  if (existing) {
    const newest = await prisma.message.findFirst({
      where: { channelId: existing.id, externalSource: 'bitrix24' },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    });
    highWater = parseBxChatId(newest?.externalId ?? null);
  }

  // 1. Pull newer messages (newest→oldest, walk LAST_ID; stop once we reach the
  //    high-water mark or run out).
  const all: BxMessage[] = [];
  let lastId: number | undefined;
  let pages = 0;
  for (; pages < MAX_PAGES; pages++) {
    if (signal?.aborted) return;
    const params: Record<string, unknown> = { DIALOG_ID: `sg${project.externalId}`, LIMIT: PAGE_LIMIT };
    if (lastId !== undefined) params.LAST_ID = lastId;
    let r;
    try {
      r = await client.call<{ messages?: BxMessage[] }>('im.dialog.messages.get', params);
    } catch (e) {
      stats.errors++;
      console.error('bitrix24 syncCollabChat: pull failed for sg', project.externalId, e);
      return;
    }
    const msgs = r.result?.messages ?? [];
    if (msgs.length === 0) break;
    const fresh = msgs.filter((m) => Number(m.id) > highWater);
    all.push(...fresh);
    const ids = msgs.map((m) => Number(m.id)).filter(Number.isFinite);
    const minId = Math.min(...ids);
    if (!Number.isFinite(minId) || minId <= highWater) break; // reached already-synced
    if (minId === lastId) break;
    lastId = minId;
    if (msgs.length < PAGE_LIMIT) break;
  }
  if (pages >= MAX_PAGES) {
    stats.truncated++;
    console.warn('bitrix24 syncCollabChat: MAX_PAGES reached, older history truncated for sg', project.externalId);
  }

  // 2. Pull succeeded → this collab IS readable. Materialize the channel now
  //    (race-safe upsert; reuse an existing one). Inaccessible collabs returned
  //    above on the 403, so they never accrue an empty channel.
  if (signal?.aborted) return;
  const channel =
    existing ??
    (await prisma.channel.upsert({
      where: { projectId_slug: { projectId: project.id, slug: CHANNEL_SLUG } },
      update: {},
      create: { kind: 'PRIVATE', slug: CHANNEL_SLUG, name: 'Чат коллаба (Bitrix24)', projectId: project.id, createdById: botId },
      select: { id: true },
    }));

  // 3. Resolve authors (bitrixUserId → local user); bot fallback. Empty set when
  //    there are no new messages this run.
  const authorBxIds = Array.from(new Set(all.map((m) => String(m.author_id)).filter((x) => x && x !== '0')));
  const localAuthors = authorBxIds.length
    ? await prisma.user.findMany({ where: { bitrixUserId: { in: authorBxIds } }, select: { id: true, bitrixUserId: true } })
    : [];
  const userByBxId = new Map(localAuthors.filter((u) => u.bitrixUserId).map((u) => [u.bitrixUserId as string, u.id]));

  // 4. Membership: the project's members + the mapped authors who post here, so
  //    a PRIVATE channel is visible to the right people (never the whole org).
  //    Refreshed on every readable run so a quiet-but-accessible collab still
  //    surfaces to its members — and they can post outbound into it.
  const memberIds = new Set<string>(userByBxId.values());
  const projMembers = await prisma.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true } });
  for (const m of projMembers) memberIds.add(m.userId);
  if (memberIds.size > 0) {
    await prisma.channelMember
      .createMany({ data: [...memberIds].map((userId) => ({ channelId: channel.id, userId })), skipDuplicates: true })
      .catch((e) => console.error('bitrix24 syncCollabChat: member add failed', e));
  }

  if (all.length === 0) return; // channel + members are ready; nothing new to write

  // 5. Upsert each new message (oldest first for sane order), race-safe.
  for (const m of all.slice().reverse()) {
    if (signal?.aborted) return;
    const externalId = `bxchat:${m.id}`;
    const isSystem = String(m.author_id) === '0';
    const authorId = (!isSystem && userByBxId.get(String(m.author_id))) || botId;
    const body = convertBitrixMarkup(m.text ?? '').trim();
    if (!body) continue;
    let createdAt = m.date ? new Date(m.date) : new Date();
    if (!Number.isFinite(createdAt.getTime())) createdAt = new Date();
    try {
      // High-water guarantees these are new ids → upsert inserts (the update
      // path only fires on a concurrent-run overlap, which is harmless).
      await prisma.message.upsert({
        where: { externalSource_externalId: { externalSource: 'bitrix24', externalId } },
        update: { body },
        create: {
          channelId: channel.id,
          authorId,
          body,
          source: isSystem ? 'SYSTEM' : 'WEB',
          externalSource: 'bitrix24',
          externalId,
          createdAt,
        },
        select: { id: true },
      });
      stats.created++;
      stats.messages++;
    } catch (e) {
      stats.errors++;
      console.error('bitrix24 syncCollabChat: upsert failed', externalId, e);
    }
  }
}
