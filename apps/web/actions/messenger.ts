'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { ensureMembership, resolveChannelAccess } from '@/lib/messenger/access';
import { publishChatEvent } from '@/lib/realtime/publishChat';
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
      where: { kind: 'PUBLIC', isArchived: false },
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
  return { memberChannels, publicChannels };
}

export async function createChannelAction(input: {
  name: string;
  kind: 'PUBLIC' | 'PRIVATE';
  projectId?: string | null;
  description?: string;
}): Promise<ActionResult<{ id: string; slug: string }>> {
  const me = await requireAuth();
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название пустое' } };
  }
  if (name.length > 60) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не длиннее 60 символов' } };
  }
  const slug = slugify(name);
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
          create: { userId: me.id, role: 'ADMIN' },
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
  await prisma.channelMember
    .delete({ where: { channelId_userId: { channelId, userId: me.id } } })
    .catch(() => null);
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
  revalidatePath('/messages');
  return { ok: true, data: created };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function postMessageAction(input: {
  channelId: string;
  body: string;
  parentId?: string | null;
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

  // Extract @mentions: pattern @<userId>. Use Set to de-dupe.
  const mentionedIds = Array.from(new Set([...body.matchAll(/@([a-z0-9]{24,})\b/g)].map((m) => m[1]!)));
  const validMentions = mentionedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: mentionedIds } },
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

  revalidatePath('/messages');
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
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { authorId: true, channelId: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } };
  }
  if (msg.authorId !== me.id && me.role !== 'ADMIN') {
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
  if (msg.authorId !== me.id && me.role !== 'ADMIN') {
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

export async function markChannelReadAction(
  channelId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  await prisma.channelMember
    .update({
      where: { channelId_userId: { channelId, userId: me.id } },
      data: { lastReadAt: new Date() },
    })
    .catch(() => null);
  return { ok: true };
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
  const where: Record<string, unknown> = {};
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

export async function searchMessagesAction(input: {
  q: string;
  channelId?: string;
  authorId?: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    body: string;
    channelId: string;
    authorId: string;
    createdAt: Date;
  }>
> {
  const me = await requireAuth();
  const q = input.q.trim();
  if (q.length < 2) return [];
  const limit = Math.min(input.limit ?? 50, 100);

  // websearch_to_tsquery handles user-typed queries with quotes/AND/OR.
  // Restrict to channels the user can see: PUBLIC + their memberships.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      body: string;
      channelId: string;
      authorId: string;
      createdAt: Date;
    }>
  >(Prisma.sql`
    SELECT m.id, m.body, m."channelId", m."authorId", m."createdAt"
    FROM "Message" m
    JOIN "Channel" c ON c.id = m."channelId"
    LEFT JOIN "ChannelMember" cm
      ON cm."channelId" = c.id AND cm."userId" = ${me.id}
    WHERE m."deletedAt" IS NULL
      AND m."searchVector" @@ websearch_to_tsquery('russian', ${q})
      AND (
        c.kind = 'PUBLIC'
        OR cm."userId" IS NOT NULL
      )
      ${input.channelId ? Prisma.sql`AND m."channelId" = ${input.channelId}` : Prisma.empty}
      ${input.authorId ? Prisma.sql`AND m."authorId" = ${input.authorId}` : Prisma.empty}
    ORDER BY m."createdAt" DESC
    LIMIT ${limit}
  `);
  return rows;
}
