'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { BITRIX_BOT_EMAIL } from '@giper/integrations/bitrix24';
import { getEffectiveCaps } from '@/lib/capabilities';
import { ensureMembership, resolveChannelAccess } from '@/lib/messenger/access';
import { loadChannelMessages } from '@/lib/messenger/queries';
import { publishChatEvent } from '@/lib/realtime/publishChat';
import { createNotification } from '@/lib/notifications/createNotifications';
import { extractTaskRefs } from '@/lib/text/taskRefs';
import { loadTaskPreviewsForRefs } from '@/lib/tasks/loadTaskPreviews';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const MESSAGE_MAX = 8_000;

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'channel'
  );
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function listMyChannels() {
  const me = await requireAuth();
  // Channels the user is a member of, plus all PUBLIC channels in the
  // org (so they're discoverable in the sidebar even before joining).
  const [memberChannels, publicChannels] = await Promise.all([
    prisma.channel.findMany({
      where: {
        members: { some: { userId: me.id } },
        isArchived: false,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        kind: true,
        slug: true,
        name: true,
        projectId: true,
        members: {
          where: { userId: me.id },
          select: { lastReadAt: true, isMuted: true, role: true },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.channel.findMany({
      // BROADCAST shares PUBLIC's discoverability — anyone in the org
      // can see and read it. Only posting is restricted.
      where: { kind: { in: ['PUBLIC', 'BROADCAST'] }, isArchived: false },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        kind: true,
        slug: true,
        name: true,
        projectId: true,
      },
    }),
  ]);
  const unread = await unreadCountsFor(
    me.id,
    memberChannels.map((c) => c.id),
  );
  return {
    memberChannels: memberChannels.map((c) => ({ ...c, unreadCount: unread.get(c.id) ?? 0 })),
    publicChannels,
  };
}

/**
 * Per-channel unread message count for a user, in one round-trip. A message
 * is unread when it was authored by someone else, is not a SYSTEM service
 * message, is not deleted, and was created after the member's lastReadAt
 * (or ever, if they've never read the channel). The sidebar badge keys off
 * this. Muted channels still count here — the UI dims them rather than
 * zeroing, so the user can still see there's activity.
 */
async function unreadCountsFor(
  userId: string,
  channelIds: string[],
): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();
  // NB: use `= ANY($array)` rather than `IN (${Prisma.join(...)})`. A Prisma.Sql
  // fragment embedded in a tagged-template $queryRaw only expands when the
  // fragment and the client share one @prisma/client instance; under Next's
  // bundler that can fail and the fragment gets bound as a jsonb value
  // ("operator does not exist: text = jsonb"), 500-ing the /messages page.
  // Passing the array as a single text[] parameter is bundler-safe.
  const rows = await prisma.$queryRaw<Array<{ channelId: string; count: bigint }>>`
    SELECT m."channelId" AS "channelId", COUNT(*)::bigint AS count
    FROM "Message" m
    JOIN "ChannelMember" cm
      ON cm."channelId" = m."channelId" AND cm."userId" = ${userId}
    WHERE m."channelId" = ANY(${channelIds})
      AND m."authorId" <> ${userId}
      AND m.source::text <> 'SYSTEM'
      AND m."deletedAt" IS NULL
      AND m."createdAt" > COALESCE(cm."lastReadAt", '-infinity'::timestamp)
    GROUP BY m."channelId"
  `;
  return new Map(rows.map((r) => [r.channelId, Number(r.count)]));
}

export async function createChannelAction(input: {
  name: string;
  kind: 'PUBLIC' | 'PRIVATE' | 'BROADCAST';
  projectId?: string | null;
  description?: string;
  /**
   * Initial invitees added as MEMBER alongside the creator (ADMIN).
   * Required for PRIVATE — a channel that nobody but the creator can
   * see is functionally a draft and is rejected at validation. For
   * PUBLIC/BROADCAST the list is optional (anyone can self-join).
   */
  memberUserIds?: string[];
}): Promise<ActionResult<{ id: string; slug: string }>> {
  const me = await requireAuth();
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название пустое' } };
  }
  if (name.length > 60) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не длиннее 60 символов' } };
  }
  const memberUserIds = (input.memberUserIds ?? []).filter((id) => id && id !== me.id);
  if (input.kind === 'PRIVATE' && memberUserIds.length === 0) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'В приватный канал нужно добавить хотя бы одного участника',
      },
    };
  }
  // Validate every invited user exists and is active. Don't trust the
  // client array — it's user-supplied input.
  let validInviteeIds: string[] = [];
  if (memberUserIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: memberUserIds }, isActive: true },
      select: { id: true },
    });
    validInviteeIds = found.map((u) => u.id);
    if (validInviteeIds.length !== memberUserIds.length) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Один или несколько участников не существуют или деактивированы',
        },
      };
    }
  }
  const slug = slugify(name);
  // For BROADCAST channels, invitees are co-authors (they need post
  // permission), so seed them as ADMIN. For PUBLIC/PRIVATE the picker
  // adds plain MEMBERs.
  const inviteeRole: 'ADMIN' | 'MEMBER' = input.kind === 'BROADCAST' ? 'ADMIN' : 'MEMBER';
  try {
    const channel = await prisma.channel.create({
      data: {
        kind: input.kind,
        slug,
        name,
        description: input.description?.trim() || null,
        projectId: input.projectId ?? null,
        createdById: me.id,
        members: {
          create: [
            { userId: me.id, role: 'ADMIN' },
            ...validInviteeIds.map((userId) => ({ userId, role: inviteeRole })),
          ],
        },
      },
      select: { id: true, slug: true },
    });
    revalidatePath('/messages');
    return { ok: true, data: channel };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: { code: 'CONFLICT', message: 'Канал с таким slug уже есть' } };
    }
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось создать канал' } };
  }
}

/**
 * Add users to an existing channel.
 *
 * Permission: caller must be an ADMIN of the channel (creator is
 * ADMIN by default). DM/GROUP_DM are NOT invitable through this
 * action — those are 1-1 / fixed-set conversations by design;
 * inviting a third party would turn a DM into a group, which is a
 * different concept and should be a separate "convert to group"
 * flow.
 */
export async function inviteToChannelAction(
  channelId: string,
  userIds: string[],
): Promise<ActionResult<{ added: number }>> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, isArchived: true },
  });
  if (!channel) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (channel.kind === 'DM' || channel.kind === 'GROUP_DM') {
    return { ok: false, error: { code: 'VALIDATION', message: 'В DM нельзя пригласить' } };
  }
  if (channel.isArchived) {
    return { ok: false, error: { code: 'GONE', message: 'Канал в архиве' } };
  }
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только админ канала может приглашать' } };
  }

  const cleanIds = Array.from(new Set(userIds.filter((id) => id && id !== me.id)));
  if (cleanIds.length === 0) {
    return { ok: true, data: { added: 0 } };
  }
  const validUsers = await prisma.user.findMany({
    where: { id: { in: cleanIds }, isActive: true },
    select: { id: true, name: true },
  });
  // Find who's already in to compute the truthful "added" count.
  // Then bulk-create the new rows (skipDuplicates as a safety net
  // in case someone joins between findMany and createMany).
  const existing = await prisma.channelMember.findMany({
    where: { channelId, userId: { in: validUsers.map((u) => u.id) } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toAdd = validUsers.filter((u) => !existingIds.has(u.id));
  // Add members AND drop one SYSTEM "added" service message per new member,
  // in the same transaction, so everyone currently in the channel sees the
  // roster change live (SystemEventCard renders MEMBER_CHANGED) instead of
  // only after their own reload. Mirrors meetings.ts CALL_STARTED.
  const systemMsgIds: string[] = [];
  if (toAdd.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.channelMember.createMany({
        data: toAdd.map((u) => ({ channelId, userId: u.id, role: 'MEMBER' as const })),
        skipDuplicates: true,
      });
      for (const u of toAdd) {
        const sys = await tx.message.create({
          data: {
            channelId,
            authorId: me.id,
            body: '',
            source: 'SYSTEM',
            eventKind: 'MEMBER_CHANGED',
            eventPayload: { action: 'added', userName: u.name ?? '' },
          },
          select: { id: true },
        });
        systemMsgIds.push(sys.id);
      }
    });
  }
  const added = toAdd.length;
  for (const messageId of systemMsgIds) {
    await publishChatEvent({ kind: 'message.new', channelId, messageId, authorId: me.id, parentId: null });
  }
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true, data: { added } };
}

/**
 * Remove a user from a channel. Same permission model as invite —
 * channel ADMIN only. The user being removed cannot be the channel
 * creator (createdById) — that role is sticky to prevent
 * locking-yourself-out scenarios.
 */
export async function removeFromChannelAction(
  channelId: string,
  userId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, createdById: true },
  });
  if (!channel) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (channel.kind === 'DM' || channel.kind === 'GROUP_DM') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Из DM нельзя удалить участника' } };
  }
  if (userId === channel.createdById) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Нельзя удалить создателя канала' },
    };
  }
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только админ канала может удалять' } };
  }
  // Only emit the service message if the member actually existed (deleteMany
  // count), so a no-op remove doesn't post a phantom "removed" card.
  const removed = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { user: { select: { name: true } } },
  });
  let systemMsgId: string | null = null;
  if (removed) {
    await prisma.$transaction(async (tx) => {
      await tx.channelMember.delete({ where: { channelId_userId: { channelId, userId } } });
      const sys = await tx.message.create({
        data: {
          channelId,
          authorId: me.id,
          body: '',
          source: 'SYSTEM',
          eventKind: 'MEMBER_CHANGED',
          eventPayload: { action: 'removed', userName: removed.user.name ?? '' },
        },
        select: { id: true },
      });
      systemMsgId = sys.id;
    });
  }
  if (systemMsgId) {
    await publishChatEvent({ kind: 'message.new', channelId, messageId: systemMsgId, authorId: me.id, parentId: null });
  }
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true };
}

/**
 * List members of a channel for the members-drawer UI.
 *
 * Permission: any channel member can see who else is in. DM/GROUP_DM
 * also work — the caller is one of the two participants.
 */
export async function listChannelMembersAction(
  channelId: string,
): Promise<
  | {
      ok: true;
      data: {
        members: Array<{
          id: string;
          name: string;
          email: string;
          image: string | null;
          role: string;
          isCreator: boolean;
        }>;
        canManage: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, createdById: true },
  });
  if (!channel) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет доступа' } };
  }
  const rows = await prisma.channelMember.findMany({
    where: { channelId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  return {
    ok: true,
    data: {
      members: rows.map((r) => ({
        id: r.user.id,
        name: r.user.name,
        email: r.user.email,
        image: r.user.image,
        role: r.role,
        isCreator: r.user.id === channel.createdById,
      })),
      canManage: myMembership.role === 'ADMIN',
    },
  };
}

export async function joinChannelAction(channelId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, isArchived: true },
  });
  if (!channel) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (channel.kind !== 'PUBLIC') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Канал не публичный' } };
  }
  if (channel.isArchived) {
    return { ok: false, error: { code: 'GONE', message: 'Канал в архиве' } };
  }
  await ensureMembership(channelId, me.id);
  revalidatePath('/messages');
  return { ok: true };
}

export async function leaveChannelAction(channelId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true },
  });
  if (!channel) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  }
  // DM/GROUP_DM are conversations between specific people — leaving one
  // unilaterally makes no sense (mirrors deleteChannelAction's guard).
  if (channel.kind === 'DM' || channel.kind === 'GROUP_DM') {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Из личного чата нельзя выйти' },
    };
  }
  const membership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { channelId: true },
  });
  if (!membership) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Вы не состоите в этом канале' },
    };
  }
  await prisma.channelMember.delete({
    where: { channelId_userId: { channelId, userId: me.id } },
  });
  revalidatePath('/messages');
  return { ok: true };
}

/**
 * Hard-delete a channel and everything underneath it (messages, members,
 * invites, attachments). Only the channel CREATOR may delete; DM and
 * GROUP_DM are explicitly refused — those are conversations between
 * specific people and shouldn't be wiped by one side.
 *
 * Caller must confirm in the UI — there is no recovery once the cascade
 * runs.
 */
export async function deleteChannelAction(
  channelId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, createdById: true },
  });
  if (!channel) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  }
  if (channel.kind === 'DM' || channel.kind === 'GROUP_DM') {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Личные чаты нельзя удалить — выйдите из них' },
    };
  }
  if (channel.createdById !== me.id) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Удалить канал может только его создатель' },
    };
  }
  // Schema has onDelete: Cascade on every child relation, so a single
  // delete here drops messages, members, invites, attachments, mentions
  // and reactions in one transaction.
  await prisma.channel.delete({ where: { id: channelId } });
  revalidatePath('/messages');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Direct Messages — find or create a 1-1 DM channel between two users
// ---------------------------------------------------------------------------

export async function getOrCreateDmAction(
  withUserId: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (withUserId === me.id) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Сам с собой нельзя' } };
  }
  // Deterministic slug per ordered pair so we never create duplicates.
  const pair = [me.id, withUserId].sort().join('--');
  const slug = `dm-${pair}`;
  const existing = await prisma.channel.findFirst({
    where: { kind: 'DM', slug },
    select: { id: true },
  });
  if (existing) return { ok: true, data: existing };

  const otherUser = await prisma.user.findUnique({
    where: { id: withUserId },
    select: { id: true, name: true },
  });
  if (!otherUser) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пользователь не найден' } };

  const created = await prisma.channel.create({
    data: {
      kind: 'DM',
      slug,
      name: otherUser.name,
      createdById: me.id,
      members: {
        create: [
          { userId: me.id, role: 'MEMBER' },
          { userId: otherUser.id, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  });
  // NOTE: no revalidatePath here. This action is invoked from the
  // /messages/dm/[userId] server component DURING RENDER (it creates-or-gets
  // the DM then redirects), and revalidatePath() during render throws in
  // Next ("used revalidatePath during render which is unsupported") → a 500 on
  // the very first DM open with a person. The redirect to /messages/<id>
  // renders fresh and the sidebar picks up the new DM on its next render, so
  // the revalidate was unnecessary anyway. The only caller is that page.
  return { ok: true, data: created };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function postMessageAction(input: {
  channelId: string;
  body: string;
  parentId?: string | null;
  /** Telegram-style inline reply: id of the quoted message (same channel). */
  replyToId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const body = input.body.trim();
  if (!body) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Сообщение пустое' } };
  }
  if (body.length > MESSAGE_MAX) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не длиннее ${MESSAGE_MAX} символов` } };
  }
  const access = await resolveChannelAccess(input.channelId, me.id);
  if (!access) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (!access.canPost) {
    if (access.kind === 'PUBLIC') {
      // Lazy-join on first post into a public channel.
      await ensureMembership(input.channelId, me.id);
    } else {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав на запись' } };
    }
  }

  // For threads, validate parent and inherit channel.
  if (input.parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: input.parentId },
      select: { channelId: true, parentId: true },
    });
    if (!parent || parent.channelId !== input.channelId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Родительское сообщение не найдено' } };
    }
    // One level of nesting only — replying to a reply pins to the same root.
    if (parent.parentId) {
      input.parentId = parent.parentId;
    }
  }

  // Inline reply quote: the quoted message must exist in THIS channel.
  if (input.replyToId) {
    const quoted = await prisma.message.findUnique({
      where: { id: input.replyToId },
      select: { channelId: true },
    });
    if (!quoted || quoted.channelId !== input.channelId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Цитируемое сообщение не найдено' } };
    }
  }

  // Extract @mentions: pattern @<userId>. Use Set to de-dupe.
  const mentionedIds = Array.from(new Set([...body.matchAll(/@([a-z0-9]{24,})\b/g)].map((m) => m[1]!)));
  const validMentions = mentionedIds.length
    ? await prisma.user.findMany({
        // Exclude the synthetic Bitrix bot so a crafted @<botId> can't persist a
        // MessageMention pointing at a non-person.
        where: { id: { in: mentionedIds }, NOT: { email: BITRIX_BOT_EMAIL } },
        select: { id: true },
      })
    : [];

  const created = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        channelId: input.channelId,
        authorId: me.id,
        body,
        parentId: input.parentId ?? null,
        replyToId: input.replyToId ?? null,
        mentions: validMentions.length
          ? { createMany: { data: validMentions.map((u) => ({ userId: u.id })) } }
          : undefined,
      },
      select: { id: true, parentId: true },
    });
    if (msg.parentId) {
      await tx.message.update({
        where: { id: msg.parentId },
        data: { replyCount: { increment: 1 } },
      });
    }
    // Bump channel updatedAt so it floats to the top of the sidebar.
    await tx.channel.update({
      where: { id: input.channelId },
      data: { updatedAt: new Date() },
    });
    return msg;
  });

  await publishChatEvent(
    {
      kind: 'message.new',
      channelId: input.channelId,
      messageId: created.id,
      authorId: me.id,
      parentId: created.parentId ?? null,
    },
    { notifyUserIds: validMentions.map((u) => u.id) },
  );

  // Two-way collab chat: if this channel mirrors a Bitrix24 collab's group chat,
  // fan the message out to that chat. Self-filtering (only `bitrix-collab`
  // channels of bitrix24 projects) + best-effort — never blocks the send.
  void (async () => {
    const { pushCollabChatMessageBestEffort } = await import('@/lib/integrations/bitrixCollabChat');
    await pushCollabChatMessageBestEffort(created.id);
  })();

  // Notify recipients: mentions (CHAT_MENTION, in any channel) + DM/GROUP_DM
  // peers (CHAT_DM). Best-effort; never blocks the send. Plain public/private
  // channel messages deliberately do NOT toast — they only bump the sidebar
  // unread badge, so a busy group channel doesn't spam every member.
  // Awaited (not fire-and-forget) so the notification rows are guaranteed
  // created before we return — recipients/badge are correct on the next read.
  await notifyNewMessage({
    channelId: input.channelId,
    messageId: created.id,
    authorId: me.id,
    authorName: me.name ?? null,
    body,
    mentionedIds: validMentions.map((u) => u.id),
  });

  revalidatePath('/messages');
  return { ok: true, data: { id: created.id } };
}

/**
 * Create in-app Notification rows (which also push a `notification:new`
 * realtime event so the inbox bell lights) + web push for a new message.
 *   - @mentions → CHAT_MENTION in every channel kind.
 *   - DM/GROUP_DM → CHAT_DM for the other participants.
 *   - plain PUBLIC/PRIVATE/BROADCAST messages → nothing (badge only).
 * Muted members are skipped entirely (no row, no toast); they still see the
 * unread badge. createNotification dedups by (kind, link) within 1h, so a
 * burst of DMs collapses into one bell entry.
 */
async function notifyNewMessage(args: {
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  mentionedIds: string[];
}): Promise<void> {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: args.channelId },
      select: {
        name: true,
        kind: true,
        members: {
          where: { isMuted: false, userId: { not: args.authorId } },
          select: { userId: true },
        },
      },
    });
    if (!channel) return;
    const nonMuted = new Set(channel.members.map((m) => m.userId));
    const mentioned = args.mentionedIds.filter((id) => nonMuted.has(id));
    const mentionedSet = new Set(mentioned);
    const link = `/messages/${args.channelId}`;
    const preview = args.body.slice(0, 160);
    const who = args.authorName ?? 'Кто-то';

    for (const userId of mentioned) {
      await createNotification({
        userId,
        kind: 'CHAT_MENTION',
        title: `${who} упомянул(а) вас в «${channel.name}»`,
        body: preview,
        link,
        payload: { messageId: args.messageId, channelId: args.channelId },
      });
    }

    const dmRecipients =
      channel.kind === 'DM' || channel.kind === 'GROUP_DM'
        ? [...nonMuted].filter((id) => !mentionedSet.has(id))
        : [];
    for (const userId of dmRecipients) {
      await createNotification({
        userId,
        kind: 'CHAT_DM',
        title: channel.kind === 'DM' ? `Сообщение от ${who}` : `${who} · «${channel.name}»`,
        body: preview,
        link,
        payload: { messageId: args.messageId, channelId: args.channelId },
      });
    }

    const pushTargets = [...new Set([...mentioned, ...dmRecipients])];
    if (pushTargets.length > 0) {
      const { sendPushToUsers } = await import('@/lib/push/sendPush');
      await sendPushToUsers(pushTargets, {
        title: channel.kind === 'DM' ? `Сообщение от ${who}` : (channel.name ?? 'Новое сообщение'),
        body: preview,
        url: link,
        tag: `chat:${args.channelId}`,
        data: { messageId: args.messageId, channelId: args.channelId },
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[messenger] notify failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Video notes (TG-style round short videos)
// ---------------------------------------------------------------------------

// Server-side caps. Mirror these in the client so the recorder stops
// early and the user gets a clear error instead of a silent server
// reject.
const VIDEO_NOTE_MAX_DURATION_SEC = 60;
const VIDEO_NOTE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB — generous for 60s @ ~1 Mbps
const VIDEO_NOTE_ALLOWED_MIME = new Set([
  'video/webm',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/mp4;codecs=avc1,mp4a',
]);

/**
 * Server action receiving a recorded video-note blob from the browser
 * and persisting it as a Message + MessageAttachment(kind=VIDEO_NOTE).
 *
 * Input is FormData because that's the only encoding that survives
 * the React Server Action transport intact for binary payloads.
 *
 * Expected fields:
 *   - channelId : string
 *   - parentId  : optional string (thread reply)
 *   - file      : Blob (video/webm or video/mp4)
 *   - duration  : string, seconds (float; floored on the server)
 *   - width     : string, pixels
 *   - height    : string, pixels
 *
 * Validation:
 *   - duration > 0 and ≤ 60s (server is the final word — client cap
 *     is a UX courtesy, not a security boundary).
 *   - size ≤ 8 MB.
 *   - mime ∈ allowed set (defends against an attacker uploading a
 *     binary blob with mislabelled extension).
 *   - posting permission via resolveChannelAccess, same as text.
 */
export async function sendVideoNoteAction(
  fd: FormData,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const channelId = String(fd.get('channelId') ?? '');
  const parentIdRaw = fd.get('parentId');
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null;
  const file = fd.get('file');
  const durationRaw = Number(fd.get('duration'));
  const widthRaw = Number(fd.get('width'));
  const heightRaw = Number(fd.get('height'));

  if (!channelId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'channelId не указан' } };
  }
  if (!(file instanceof Blob)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Файл не передан' } };
  }
  if (file.size === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Пустой файл' } };
  }
  if (file.size > VIDEO_NOTE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: `Файл слишком большой (${(file.size / 1_048_576).toFixed(1)} МБ, лимит 8 МБ)`,
      },
    };
  }
  // MIME source order: explicit form field first (the client knows
  // best what it recorded), Blob.type second, fallback last.
  // Server-Action's FormData serialization can flatten a Blob's
  // Content-Type to text/plain on the way over the wire, so we
  // don't trust file.type alone — that's why the recorder also
  // sends a `mime` field.
  const mimeField = String(fd.get('mime') ?? '').trim();
  const mime = mimeField || file.type || 'application/octet-stream';
  if (!VIDEO_NOTE_ALLOWED_MIME.has(mime) && !mime.startsWith('video/')) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: `Тип файла "${mime}" не поддерживается` },
    };
  }
  if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Длительность не указана' } };
  }
  if (durationRaw > VIDEO_NOTE_MAX_DURATION_SEC + 0.5) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: `Видео слишком длинное (${Math.round(durationRaw)}с, лимит ${VIDEO_NOTE_MAX_DURATION_SEC}с)`,
      },
    };
  }
  const duration = Math.min(
    VIDEO_NOTE_MAX_DURATION_SEC,
    Math.max(1, Math.round(durationRaw)),
  );
  const width = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.round(widthRaw) : null;
  const height = Number.isFinite(heightRaw) && heightRaw > 0 ? Math.round(heightRaw) : null;

  const access = await resolveChannelAccess(channelId, me.id);
  if (!access) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (!access.canPost) {
    if (access.kind === 'PUBLIC') {
      await ensureMembership(channelId, me.id);
    } else {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав на запись' } };
    }
  }

  // Thread parent validation, same rules as postMessageAction.
  let finalParentId: string | null = null;
  if (parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: parentId },
      select: { channelId: true, parentId: true },
    });
    if (!parent || parent.channelId !== channelId) {
      return {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Родительское сообщение не найдено' },
      };
    }
    finalParentId = parent.parentId ?? parent.channelId ? parent.parentId ?? parentId : parentId;
    if (parent.parentId) finalParentId = parent.parentId;
  }

  // Lazy-import the storage helpers — keeps the server-action's
  // import graph cheap when the user isn't recording.
  const { putObject, buildVideoNoteKey } = await import('@/lib/storage/s3');
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const key = buildVideoNoteKey(channelId, ext);
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buf, contentType: mime });

  const created = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        channelId,
        authorId: me.id,
        body: '',
        parentId: finalParentId,
        attachments: {
          create: {
            filename: `video-note.${ext}`,
            mimeType: mime,
            sizeBytes: file.size,
            storageKey: key,
            kind: 'VIDEO_NOTE',
            durationSec: duration,
            width,
            height,
          },
        },
      },
      select: { id: true, parentId: true },
    });
    if (msg.parentId) {
      await tx.message.update({
        where: { id: msg.parentId },
        data: { replyCount: { increment: 1 } },
      });
    }
    await tx.channel.update({
      where: { id: channelId },
      data: { updatedAt: new Date() },
    });
    return msg;
  });

  await publishChatEvent({
    kind: 'message.new',
    channelId,
    messageId: created.id,
    authorId: me.id,
    parentId: created.parentId ?? null,
  });
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true, data: { id: created.id } };
}

// ---------------------------------------------------------------------------
// Generic file / image attachments
// ---------------------------------------------------------------------------

const FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file — matches task attachments
const FILE_ALLOWED_MIME = /^(image|video|audio|application|text)\//;

/**
 * Upload a generic file/image as a Message + MessageAttachment. image/* lands
 * as kind=IMAGE (rendered inline), everything else as kind=FILE (download
 * chip). Same auth/access/thread-parent rules as postMessageAction; the
 * download route (api/messages/attachments/[id]) forces unsafe mimes to
 * download as octet-stream so an uploaded SVG/HTML can't execute in-origin.
 *
 * FormData fields: channelId, optional parentId, file (Blob), optional
 * filename / mime overrides, optional width/height (for images).
 */
export async function sendFileAction(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const channelId = String(fd.get('channelId') ?? '');
  const parentIdRaw = fd.get('parentId');
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null;
  const file = fd.get('file');

  if (!channelId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'channelId не указан' } };
  }
  if (!(file instanceof Blob)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Файл не передан' } };
  }
  if (file.size === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Пустой файл' } };
  }
  if (file.size > FILE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: `Файл слишком большой (${(file.size / 1_048_576).toFixed(1)} МБ, лимит 25 МБ)`,
      },
    };
  }
  // Filename: explicit field first (SA transport can drop File.name), then the
  // Blob's own name if it's a File, then a fallback.
  const filenameField = String(fd.get('filename') ?? '').trim();
  const blobName = file instanceof File ? file.name : '';
  const filename = (filenameField || blobName || 'file').slice(0, 200);
  // MIME: explicit field first (SA can flatten Blob.type to text/plain).
  const mimeField = String(fd.get('mime') ?? '').trim();
  const mime = mimeField || file.type || 'application/octet-stream';
  if (!FILE_ALLOWED_MIME.test(mime)) {
    return { ok: false, error: { code: 'VALIDATION', message: `Тип файла "${mime}" не поддерживается` } };
  }
  const isImage = mime.startsWith('image/');
  const widthRaw = Number(fd.get('width'));
  const heightRaw = Number(fd.get('height'));
  const width = isImage && Number.isFinite(widthRaw) && widthRaw > 0 ? Math.round(widthRaw) : null;
  const height = isImage && Number.isFinite(heightRaw) && heightRaw > 0 ? Math.round(heightRaw) : null;

  const access = await resolveChannelAccess(channelId, me.id);
  if (!access) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (!access.canPost) {
    if (access.kind === 'PUBLIC') {
      await ensureMembership(channelId, me.id);
    } else {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав на запись' } };
    }
  }

  let finalParentId: string | null = null;
  if (parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: parentId },
      select: { channelId: true, parentId: true },
    });
    if (!parent || parent.channelId !== channelId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Родительское сообщение не найдено' } };
    }
    finalParentId = parent.parentId ?? parentId;
  }

  const { putObject, buildMessageFileKey } = await import('@/lib/storage/s3');
  const key = buildMessageFileKey(channelId, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buf, contentType: mime });

  const created = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        channelId,
        authorId: me.id,
        body: '',
        parentId: finalParentId,
        attachments: {
          create: {
            filename,
            mimeType: mime,
            sizeBytes: file.size,
            storageKey: key,
            kind: isImage ? 'IMAGE' : 'FILE',
            width,
            height,
          },
        },
      },
      select: { id: true, parentId: true },
    });
    if (msg.parentId) {
      await tx.message.update({ where: { id: msg.parentId }, data: { replyCount: { increment: 1 } } });
    }
    await tx.channel.update({ where: { id: channelId }, data: { updatedAt: new Date() } });
    return msg;
  });

  await publishChatEvent({
    kind: 'message.new',
    channelId,
    messageId: created.id,
    authorId: me.id,
    parentId: created.parentId ?? null,
  });
  // DM/mention notifications use the filename as the preview text.
  await notifyNewMessage({
    channelId,
    messageId: created.id,
    authorId: me.id,
    authorName: me.name ?? null,
    body: filename,
    mentionedIds: [],
  });
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true, data: { id: created.id } };
}

// ---------------------------------------------------------------------------
// Voice / audio notes (TG-style push-to-record voice messages)
// ---------------------------------------------------------------------------

const AUDIO_NOTE_MAX_DURATION_SEC = 300; // 5 minutes
const AUDIO_NOTE_MAX_BYTES = 12 * 1024 * 1024; // 12 MB

/**
 * Persist a recorded voice message as Message + MessageAttachment
 * (kind=AUDIO_NOTE). Mirrors sendVideoNoteAction: server is the final word on
 * size/mime/duration; posting permission via resolveChannelAccess. Served
 * inline by the hardened attachment route (audio/* is inline-safe).
 *
 * FormData: channelId, optional parentId, file (Blob audio/*), duration (sec),
 * optional mime override.
 */
export async function sendAudioNoteAction(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const channelId = String(fd.get('channelId') ?? '');
  const parentIdRaw = fd.get('parentId');
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null;
  const file = fd.get('file');
  const durationRaw = Number(fd.get('duration'));

  if (!channelId) return { ok: false, error: { code: 'VALIDATION', message: 'channelId не указан' } };
  if (!(file instanceof Blob)) return { ok: false, error: { code: 'VALIDATION', message: 'Файл не передан' } };
  if (file.size === 0) return { ok: false, error: { code: 'VALIDATION', message: 'Пустой файл' } };
  if (file.size > AUDIO_NOTE_MAX_BYTES) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: `Файл слишком большой (лимит ${AUDIO_NOTE_MAX_BYTES / 1_048_576} МБ)` },
    };
  }
  const mimeField = String(fd.get('mime') ?? '').trim();
  const mime = mimeField || file.type || 'application/octet-stream';
  if (!mime.startsWith('audio/')) {
    return { ok: false, error: { code: 'VALIDATION', message: `Тип файла "${mime}" не поддерживается` } };
  }
  if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Длительность не указана' } };
  }
  if (durationRaw > AUDIO_NOTE_MAX_DURATION_SEC + 0.5) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: `Слишком длинная запись (лимит ${AUDIO_NOTE_MAX_DURATION_SEC}с)` },
    };
  }
  const duration = Math.min(AUDIO_NOTE_MAX_DURATION_SEC, Math.max(1, Math.round(durationRaw)));

  const access = await resolveChannelAccess(channelId, me.id);
  if (!access) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (!access.canPost) {
    if (access.kind === 'PUBLIC') {
      await ensureMembership(channelId, me.id);
    } else {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав на запись' } };
    }
  }

  let finalParentId: string | null = null;
  if (parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: parentId },
      select: { channelId: true, parentId: true },
    });
    if (!parent || parent.channelId !== channelId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Родительское сообщение не найдено' } };
    }
    finalParentId = parent.parentId ?? parentId;
  }

  const ext = mime.includes('mp4')
    ? 'm4a'
    : mime.includes('mpeg')
      ? 'mp3'
      : mime.includes('ogg')
        ? 'ogg'
        : 'webm';
  const { putObject, buildMessageFileKey } = await import('@/lib/storage/s3');
  const key = buildMessageFileKey(channelId, `voice.${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buf, contentType: mime });

  const created = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        channelId,
        authorId: me.id,
        body: '',
        parentId: finalParentId,
        attachments: {
          create: {
            filename: `voice.${ext}`,
            mimeType: mime,
            sizeBytes: file.size,
            storageKey: key,
            kind: 'AUDIO_NOTE',
            durationSec: duration,
          },
        },
      },
      select: { id: true, parentId: true },
    });
    if (msg.parentId) {
      await tx.message.update({ where: { id: msg.parentId }, data: { replyCount: { increment: 1 } } });
    }
    await tx.channel.update({ where: { id: channelId }, data: { updatedAt: new Date() } });
    return msg;
  });

  await publishChatEvent({
    kind: 'message.new',
    channelId,
    messageId: created.id,
    authorId: me.id,
    parentId: created.parentId ?? null,
  });
  await notifyNewMessage({
    channelId,
    messageId: created.id,
    authorId: me.id,
    authorName: me.name ?? null,
    body: '🎤 Голосовое сообщение',
    mentionedIds: [],
  });
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true, data: { id: created.id } };
}

export async function editMessageAction(
  messageId: string,
  body: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Сообщение пустое' } };
  }
  // Same length cap as postMessageAction — the edit path must not let a client
  // smuggle in an over-limit body the create path would have rejected.
  if (trimmed.length > MESSAGE_MAX) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не длиннее ${MESSAGE_MAX} символов` } };
  }
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { authorId: true, channelId: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  // The actor must have read access to the channel. Without this, an
  // org-level ADMIN who is NOT a member could edit messages in a PRIVATE
  // channel / DM they can't even see (the role check below is org-global,
  // not channel-scoped). Authors always have access (they're members).
  const access = await resolveChannelAccess(msg.channelId, me.id);
  if (!access || !access.canRead) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  const canModerate = (await getEffectiveCaps({ id: me.id, role: me.role })).has('messenger.message.moderateAny');
  if (msg.authorId !== me.id && !canModerate) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нельзя редактировать чужое сообщение' } };
  }
  await prisma.message.update({
    where: { id: messageId },
    data: { body: trimmed, editedAt: new Date() },
  });
  await publishChatEvent({
    kind: 'message.edited',
    channelId: msg.channelId,
    messageId,
  });
  revalidatePath('/messages');
  return { ok: true };
}

export async function deleteMessageAction(messageId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { authorId: true, channelId: true, parentId: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  // Same channel-access guard as editMessageAction: an org-level ADMIN must
  // still be a member to act in a PRIVATE channel / DM.
  const access = await resolveChannelAccess(msg.channelId, me.id);
  if (!access || !access.canRead) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  const canModerate = (await getEffectiveCaps({ id: me.id, role: me.role })).has('messenger.message.moderateAny');
  if (msg.authorId !== me.id && !canModerate) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нельзя удалить чужое сообщение' } };
  }
  await prisma.$transaction(async (tx) => {
    // Soft-delete: keep the row so threads/replies still resolve and
    // edit history is auditable. UI renders "Сообщение удалено".
    await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '' },
    });
    if (msg.parentId) {
      await tx.message.update({
        where: { id: msg.parentId },
        data: { replyCount: { decrement: 1 } },
      });
    }
  });
  await publishChatEvent({
    kind: 'message.deleted',
    channelId: msg.channelId,
    messageId,
  });
  revalidatePath('/messages');
  return { ok: true };
}

/**
 * Pin (or unpin) a message in its channel. Only channel ADMINs can
 * pin — same role gate used for invite/remove. We don't cap the
 * number of pinned messages; the UI shows them as a collapsible
 * stack at the top of the channel.
 */
export async function setPinnedAction(
  messageId: string,
  pinned: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { channelId: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId: msg.channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Только админ канала может закреплять сообщения' },
    };
  }
  await prisma.message.update({
    where: { id: messageId },
    data: pinned
      ? { pinnedAt: new Date(), pinnedById: me.id }
      : { pinnedAt: null, pinnedById: null },
  });
  await publishChatEvent({
    kind: 'message.edited',
    channelId: msg.channelId,
    messageId,
  });
  revalidatePath('/messages');
  revalidatePath(`/messages/${msg.channelId}`);
  return { ok: true };
}

/**
 * List currently-pinned messages for a channel. Capped at 50 — TG-
 * level density without runaway memory if someone decides to pin
 * a whole sprint.
 */
export async function listPinnedMessagesAction(channelId: string) {
  const me = await requireAuth();
  const access = await resolveChannelAccess(channelId, me.id);
  if (!access?.canRead) return null;
  const rows = await prisma.message.findMany({
    where: { channelId, pinnedAt: { not: null }, deletedAt: null },
    orderBy: { pinnedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      body: true,
      source: true,
      eventKind: true,
      eventPayload: true,
      pinnedAt: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
      attachments: {
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          width: true,
          height: true,
          filename: true,
        },
      },
    },
  });
  return rows;
}

/**
 * Toggle mute on a channel for the current user. Mute = the user
 * stays a member, keeps reading, but stops receiving push pings
 * AND the sidebar unread badge doesn't count new messages. (The
 * second is checked in the listMyChannels query.)
 */
export async function setChannelMutedAction(
  channelId: string,
  muted: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  const result = await prisma.channelMember.updateMany({
    where: { channelId, userId: me.id },
    data: { isMuted: muted },
  });
  if (result.count === 0) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Вы не участник канала' } };
  }
  revalidatePath('/messages');
  revalidatePath(`/messages/${channelId}`);
  return { ok: true };
}

export async function markChannelReadAction(
  channelId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const updated = await prisma.channelMember
    .update({
      where: { channelId_userId: { channelId, userId: me.id } },
      data: { lastReadAt: new Date() },
      select: { channelId: true },
    })
    .catch(() => null);
  // Tell the user's OTHER tabs (and, for read-receipts later, the channel)
  // that this user has caught up, so the sidebar badge clears live.
  if (updated) {
    await publishChatEvent(
      { kind: 'channel.read', channelId, userId: me.id },
      { notifyUserIds: [me.id] },
    );
  }
  return { ok: true };
}

/**
 * Load one older page of channel history (infinite scroll-up). Wraps the
 * `before` cursor already supported by loadChannelMessages. `before` is the
 * createdAt of the OLDEST message currently in the client window (ISO string).
 * Returns messages in chronological order (oldest-first) ready to prepend,
 * plus the mention/task-preview lookups for the new rows and a hasMore flag.
 * Null when the caller can't read the channel.
 */
export async function loadOlderMessagesAction(input: {
  channelId: string;
  before: string;
  limit?: number;
}) {
  const me = await requireAuth();
  const beforeDate = new Date(input.before);
  if (Number.isNaN(beforeDate.getTime())) {
    return { messages: [], mentionedUsers: [], taskPreviews: [], hasMore: false };
  }
  const limit = Math.min(input.limit ?? 50, 100);
  const loaded = await loadChannelMessages(input.channelId, me.id, {
    before: beforeDate,
    limit,
  });
  if (!loaded) return null;
  return {
    // loadChannelMessages returns newest-first → reverse for prepend.
    messages: [...loaded.messages].reverse(),
    mentionedUsers: loaded.mentionedUsers,
    taskPreviews: loaded.taskPreviews,
    hasMore: loaded.messages.length === limit,
  };
}

/**
 * Load the root + replies of a thread. Used by the thread sidebar.
 * Returns null when the user can't read the parent channel.
 */
export async function loadThreadAction(rootMessageId: string) {
  const me = await requireAuth();
  const root = await prisma.message.findUnique({
    where: { id: rootMessageId },
    select: {
      id: true,
      body: true,
      authorId: true,
      author: { select: { id: true, name: true, image: true } },
      parentId: true,
      replyCount: true,
      editedAt: true,
      createdAt: true,
      channelId: true,
      reactions: { select: { userId: true, emoji: true } },
      attachments: {
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          width: true,
          height: true,
          filename: true,
        },
      },
    },
  });
  if (!root) return null;
  const access = await resolveChannelAccess(root.channelId, me.id);
  if (!access?.canRead) return null;

  const replies = await prisma.message.findMany({
    where: { parentId: rootMessageId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      authorId: true,
      author: { select: { id: true, name: true, image: true } },
      parentId: true,
      replyCount: true,
      editedAt: true,
      createdAt: true,
      reactions: { select: { userId: true, emoji: true } },
      mentions: { select: { userId: true } },
      attachments: {
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          width: true,
          height: true,
          filename: true,
        },
      },
    },
  });

  // Mentioned users across root + replies, resolved in one query.
  const rootMentions = await prisma.messageMention.findMany({
    where: { messageId: rootMessageId },
    select: { userId: true },
  });
  const ids = Array.from(
    new Set([
      ...rootMentions.map((x) => x.userId),
      ...replies.flatMap((r) => r.mentions.map((x) => x.userId)),
    ]),
  );
  const mentionedUsers = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, image: true },
      })
    : [];

  // Same task-ref extraction as loadChannelMessages — visibility is
  // applied per viewer (me.id) inside loadTaskPreviewsForRefs.
  const allRefs = [
    ...extractTaskRefs(root.body),
    ...replies.flatMap((r) => extractTaskRefs(r.body)),
  ];
  const uniqueRefs = Array.from(
    new Map(allRefs.map((r) => [`${r.key}-${r.number}`, r])).values(),
  );
  const taskPreviewsMap = uniqueRefs.length
    ? await loadTaskPreviewsForRefs(uniqueRefs, me.id)
    : null;
  const taskPreviews = taskPreviewsMap ? Array.from(taskPreviewsMap.values()) : [];

  return { root, replies, channelId: root.channelId, mentionedUsers, taskPreviews };
}

/**
 * User search reused by @mention autocomplete and the UserPicker
 * (assignee/reviewer/co-assignee). Default: active users only — that
 * keeps the 519 Bitrix-mirrored stubs out of assignee dropdowns. Pass
 * `includeInactive: true` to mention/ping someone who can't log in
 * yet (they'll still resolve as a comment/task author).
 */
export async function searchUsersForMention(
  q: string,
  opts: { includeInactive?: boolean } = {},
) {
  await requireAuth();
  const trimmed = q.trim();
  // Never offer the synthetic Bitrix bot as a mention target — it's an inert
  // system author, not a person.
  const where: Record<string, unknown> = { NOT: { email: BITRIX_BOT_EMAIL } };
  if (!opts.includeInactive) {
    where.isActive = true;
  }
  if (trimmed) {
    where.OR = [
      { name: { contains: trimmed, mode: 'insensitive' } },
      { email: { contains: trimmed, mode: 'insensitive' } },
    ];
  }
  return prisma.user.findMany({
    where,
    take: 25,
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, email: true, image: true },
  });
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export async function toggleReactionAction(
  messageId: string,
  emoji: string,
): Promise<ActionResult<{ added: boolean }>> {
  const me = await requireAuth();
  const cleanEmoji = emoji.trim().slice(0, 16);
  if (!cleanEmoji) return { ok: false, error: { code: 'VALIDATION', message: 'Пустая реакция' } };
  const existing = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: { messageId, userId: me.id, emoji: cleanEmoji },
    },
  });
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { channelId: true },
  });
  if (!msg) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  // You may only react to messages in a channel you can read. Without this,
  // any authed user with a messageId could react inside a PRIVATE channel /
  // DM they aren't in, and the reaction.changed event would surface their
  // presence to the real members.
  const access = await resolveChannelAccess(msg.channelId, me.id);
  if (!access || !access.canRead) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }

  if (existing) {
    await prisma.messageReaction.delete({
      where: {
        messageId_userId_emoji: { messageId, userId: me.id, emoji: cleanEmoji },
      },
    });
    await publishChatEvent({
      kind: 'reaction.changed',
      channelId: msg.channelId,
      messageId,
      userId: me.id,
      emoji: cleanEmoji,
      added: false,
    });
    return { ok: true, data: { added: false } };
  }
  await prisma.messageReaction.create({
    data: { messageId, userId: me.id, emoji: cleanEmoji },
  });
  await publishChatEvent({
    kind: 'reaction.changed',
    channelId: msg.channelId,
    messageId,
    userId: me.id,
    emoji: cleanEmoji,
    added: true,
  });
  return { ok: true, data: { added: true } };
}

// ---------------------------------------------------------------------------
// Search (Postgres tsvector + GIN). Filters: channel, author, since.
// ---------------------------------------------------------------------------

export type MessageSearchHit = {
  id: string;
  body: string;
  channelId: string;
  channelName: string;
  channelKind: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
  /** ts_headline snippet with <<match>> markers for the UI to highlight. */
  headline: string;
};

export async function searchMessagesAction(input: {
  q: string;
  channelId?: string;
  authorId?: string;
  limit?: number;
}): Promise<MessageSearchHit[]> {
  const me = await requireAuth();
  const q = input.q.trim();
  if (q.length < 2) return [];
  const limit = Math.min(input.limit ?? 50, 100);

  // websearch_to_tsquery handles user-typed queries with quotes/AND/OR.
  // Visibility: org-readable channels (PUBLIC + BROADCAST) OR the user's own
  // memberships (private/DM). Enriched with channel + author + a ts_headline
  // snippet so the results page can render rich, highlighted hits.
  const rows = await prisma.$queryRaw<MessageSearchHit[]>(Prisma.sql`
    SELECT m.id, m.body, m."channelId", m."authorId", m."createdAt",
           c.name AS "channelName", c.kind::text AS "channelKind",
           u.name AS "authorName",
           ts_headline('russian', m.body, websearch_to_tsquery('russian', ${q}),
             'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=14,MinWords=4,ShortWord=2') AS headline
    FROM "Message" m
    JOIN "Channel" c ON c.id = m."channelId"
    JOIN "User" u ON u.id = m."authorId"
    LEFT JOIN "ChannelMember" cm
      ON cm."channelId" = c.id AND cm."userId" = ${me.id}
    WHERE m."deletedAt" IS NULL
      AND m.source <> 'SYSTEM'
      AND m."searchVector" @@ websearch_to_tsquery('russian', ${q})
      AND (
        c.kind::text IN ('PUBLIC', 'BROADCAST')
        OR cm."userId" IS NOT NULL
      )
      ${input.channelId ? Prisma.sql`AND m."channelId" = ${input.channelId}` : Prisma.empty}
      ${input.authorId ? Prisma.sql`AND m."authorId" = ${input.authorId}` : Prisma.empty}
    ORDER BY m."createdAt" DESC
    LIMIT ${limit}
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// Invite links — Telegram-style /i/<token>. PRIVATE channels only.
// PUBLIC = anyone-in-org joins, DM/GROUP_DM = explicit pair, so neither
// needs a link.
// ---------------------------------------------------------------------------

const INVITE_TOKEN_BYTES = 18; // 24 base64url chars — short enough to share.

function generateInviteToken(): string {
  // URL-safe random. Node's randomUUID gives 22 base64 chars after stripping
  // dashes; we prefer raw 18 bytes → base64url for an 24-char token without
  // padding ("=").
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  return randomBytes(INVITE_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Create an invite link for a PRIVATE channel. Only channel admins can.
 * Optional expiry (ms) and maxUses mirror Telegram semantics.
 */
export async function createChannelInviteAction(
  channelId: string,
  opts: { expiresAt?: Date | null; maxUses?: number | null } = {},
): Promise<ActionResult<{ id: string; token: string }>> {
  const me = await requireAuth();
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, isArchived: true },
  });
  if (!channel) return { ok: false, error: { code: 'NOT_FOUND', message: 'Канал не найден' } };
  if (channel.kind !== 'PRIVATE') {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Ссылка-приглашение только для приватных каналов' },
    };
  }
  if (channel.isArchived) {
    return { ok: false, error: { code: 'GONE', message: 'Канал в архиве' } };
  }
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только админ канала' } };
  }
  if (opts.maxUses != null && (opts.maxUses < 1 || !Number.isInteger(opts.maxUses))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'maxUses должно быть положительным целым' } };
  }
  if (opts.expiresAt && opts.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Срок истёк ещё до создания' } };
  }

  // Retry once on the astronomically-unlikely token collision.
  let invite: { id: string; token: string } | null = null;
  for (let attempt = 0; attempt < 3 && !invite; attempt++) {
    const token = generateInviteToken();
    try {
      const row = await prisma.channelInvite.create({
        data: {
          channelId,
          token,
          createdById: me.id,
          expiresAt: opts.expiresAt ?? null,
          maxUses: opts.maxUses ?? null,
        },
        select: { id: true, token: true },
      });
      invite = row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  if (!invite) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось создать ссылку' } };
  }
  revalidatePath(`/messages/${channelId}`);
  return { ok: true, data: invite };
}

/**
 * Revoke an invite link. The link becomes unusable immediately.
 * Admin-only. Idempotent on already-revoked rows.
 */
export async function revokeChannelInviteAction(
  inviteId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const invite = await prisma.channelInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, channelId: true, revokedAt: true },
  });
  if (!invite) return { ok: false, error: { code: 'NOT_FOUND', message: 'Ссылка не найдена' } };
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId: invite.channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только админ канала' } };
  }
  if (!invite.revokedAt) {
    await prisma.channelInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }
  revalidatePath(`/messages/${invite.channelId}`);
  return { ok: true };
}

/**
 * List active + revoked invites for a channel (admins manage them via UI).
 */
export async function listChannelInvitesAction(
  channelId: string,
): Promise<
  | {
      ok: true;
      data: Array<{
        id: string;
        token: string;
        expiresAt: Date | null;
        maxUses: number | null;
        useCount: number;
        revokedAt: Date | null;
        createdAt: Date;
        createdBy: { id: string; name: string };
      }>;
    }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  const myMembership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
    select: { role: true },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только админ канала' } };
  }
  const rows = await prisma.channelInvite.findMany({
    where: { channelId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      token: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
  return { ok: true, data: rows };
}

/**
 * Preview an invite by token (public — used by /i/[token] landing page).
 * Returns minimal channel info so the user can decide whether to join.
 * Caller must still be authenticated to actually accept.
 */
export async function previewChannelInviteAction(
  token: string,
): Promise<
  | {
      ok: true;
      data: {
        channelId: string;
        channelName: string;
        channelKind: 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM' | 'BROADCAST';
        memberCount: number;
        isValid: boolean;
        reason?: string;
      };
    }
  | { ok: false; error: { code: string; message: string } }
> {
  await requireAuth();
  const invite = await prisma.channelInvite.findUnique({
    where: { token },
    select: {
      id: true,
      channelId: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      revokedAt: true,
      channel: {
        select: { id: true, name: true, kind: true, isArchived: true, _count: { select: { members: true } } },
      },
    },
  });
  if (!invite) return { ok: false, error: { code: 'NOT_FOUND', message: 'Ссылка не найдена' } };

  let isValid = true;
  let reason: string | undefined;
  if (invite.revokedAt) {
    isValid = false;
    reason = 'Ссылка отозвана';
  } else if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
    isValid = false;
    reason = 'Срок ссылки истёк';
  } else if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    isValid = false;
    reason = 'Лимит использований исчерпан';
  } else if (invite.channel.isArchived) {
    isValid = false;
    reason = 'Канал в архиве';
  }
  return {
    ok: true,
    data: {
      channelId: invite.channel.id,
      channelName: invite.channel.name,
      channelKind: invite.channel.kind,
      memberCount: invite.channel._count.members,
      isValid,
      reason,
    },
  };
}

/**
 * Accept an invite — joins the caller as MEMBER of the channel and
 * atomically increments useCount. Validates expiry/maxUses/revocation
 * under transaction so two simultaneous accepts don't both pass.
 */
export async function acceptChannelInviteAction(
  token: string,
): Promise<ActionResult<{ channelId: string }>> {
  const me = await requireAuth();
  try {
    const channelId = await prisma.$transaction(async (tx) => {
      const invite = await tx.channelInvite.findUnique({
        where: { token },
        select: {
          id: true,
          channelId: true,
          expiresAt: true,
          maxUses: true,
          useCount: true,
          revokedAt: true,
          channel: { select: { id: true, isArchived: true } },
        },
      });
      if (!invite) throw new Error('NOT_FOUND');
      if (invite.revokedAt) throw new Error('REVOKED');
      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        throw new Error('EXPIRED');
      }
      if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
        throw new Error('EXHAUSTED');
      }
      if (invite.channel.isArchived) throw new Error('ARCHIVED');

      // Already a member? Treat as no-op success without touching counters.
      const existing = await tx.channelMember.findUnique({
        where: { channelId_userId: { channelId: invite.channelId, userId: me.id } },
        select: { userId: true },
      });
      if (existing) return invite.channelId;

      // Atomic counter bump conditioned on maxUses to defeat races.
      // Raw SQL because Prisma can't express "maxUses IS NULL OR maxUses > useCount"
      // with a column-column comparison in updateMany.where.
      const updated = await tx.$executeRaw`
        UPDATE "ChannelInvite"
        SET "useCount" = "useCount" + 1
        WHERE "id" = ${invite.id}
          AND "revokedAt" IS NULL
          AND ("maxUses" IS NULL OR "maxUses" > "useCount")
      `;
      if (updated === 0) throw new Error('EXHAUSTED');

      await tx.channelMember.create({
        data: { channelId: invite.channelId, userId: me.id, role: 'MEMBER' },
      });
      return invite.channelId;
    });
    revalidatePath('/messages');
    revalidatePath(`/messages/${channelId}`);
    return { ok: true, data: { channelId } };
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    const map: Record<string, { code: string; message: string }> = {
      NOT_FOUND: { code: 'NOT_FOUND', message: 'Ссылка не найдена' },
      REVOKED: { code: 'GONE', message: 'Ссылка отозвана' },
      EXPIRED: { code: 'GONE', message: 'Срок ссылки истёк' },
      EXHAUSTED: { code: 'GONE', message: 'Лимит использований исчерпан' },
      ARCHIVED: { code: 'GONE', message: 'Канал в архиве' },
    };
    return { ok: false, error: map[code] ?? { code: 'INTERNAL', message: 'Не удалось вступить' } };
  }
}
