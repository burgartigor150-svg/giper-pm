import { prisma, Prisma, type NotificationKind } from '@giper/db';
import { publishRealtime } from '@giper/realtime/server';
import { channelForUser } from '@giper/realtime';

type CreateInput = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  payload?: Prisma.InputJsonValue;
};

/**
 * Create a notification row and push a `notification:new` event to the
 * recipient's personal realtime channel so the inbox bell updates
 * without a refresh. Returns the created notification id (caller can
 * embed it in something else if needed).
 *
 * If the recipient already has an unread notification for the same
 * (kind, link) pair within the last hour, we skip — prevents the inbox
 * from filling up with "X commented" 5 times when X commented 5 times
 * in two minutes. Caller can opt out with `dedupe: false`.
 */
export async function createNotification(
  input: CreateInput,
  opts: { dedupe?: boolean } = {},
): Promise<string | null> {
  const dedupe = opts.dedupe ?? true;
  if (dedupe && input.link) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        kind: input.kind,
        link: input.link,
        isRead: false,
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
      select: { id: true },
    });
    if (recent) return null;
  }
  const created = await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      payload: input.payload ?? Prisma.JsonNull,
    },
    select: { id: true },
  });
  // Best-effort realtime push; the inbox will still pick it up on the
  // next render even if WS is down.
  void publishRealtime({
    channel: channelForUser(input.userId),
    payload: { type: 'notification:new', id: created.id, kind: input.kind },
  });
  return created.id;
}

/**
 * Fan-out helper for "this happened on a task — notify everyone who
 * cares". Recipients are: assignee, creator, all explicit watchers.
 * The actor (the user who caused the event) is filtered out so people
 * don't get pinged about their own actions. Pass `excludeUserIds` to
 * skip people who are already getting a more specific notification
 * (e.g. mentioned in a comment).
 */
export async function fanoutToTaskAudience(
  taskId: string,
  actorId: string,
  notification: Omit<CreateInput, 'userId'>,
  opts: { excludeUserIds?: string[] } = {},
): Promise<number> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assigneeId: true,
      creatorId: true,
      watchers: { select: { userId: true } },
    },
  });
  if (!task) return 0;
  const recipients = new Set<string>();
  if (task.assigneeId) recipients.add(task.assigneeId);
  recipients.add(task.creatorId);
  for (const w of task.watchers) recipients.add(w.userId);
  recipients.delete(actorId);
  for (const id of opts.excludeUserIds ?? []) recipients.delete(id);
  let count = 0;
  for (const userId of recipients) {
    const id = await createNotification({ ...notification, userId });
    if (id) count++;
  }
  return count;
}

// Re-export Prisma's JsonNull symbol so callers don't need a separate import.
export { Prisma };
