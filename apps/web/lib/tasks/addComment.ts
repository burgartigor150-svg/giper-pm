import { prisma, type CommentSource, type CommentVisibility } from '@giper/db';
import { DomainError } from '../errors';
import { canViewTask, type SessionUser } from '../permissions';

export async function addComment(
  taskId: string,
  body: string,
  user: SessionUser,
  opts: { source?: CommentSource; visibility?: CommentVisibility } = {},
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canViewTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  return prisma.comment.create({
    data: {
      taskId,
      authorId: user.id,
      body,
      source: opts.source ?? 'WEB',
      visibility: opts.visibility ?? 'EXTERNAL',
    },
    select: {
      id: true,
      body: true,
      visibility: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  });
}
