import { prisma, type CommentSource } from '@giper/db';
import { DomainError } from '../errors';
import { canViewTask, type SessionUser } from '../permissions';

export async function addComment(
  taskId: string,
  body: string,
  user: SessionUser,
  source: CommentSource = 'WEB',
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
      source,
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  });
}
