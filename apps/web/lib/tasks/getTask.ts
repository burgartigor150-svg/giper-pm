import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canViewTask, type SessionUser } from '../permissions';

export async function getTask(projectKey: string, number: number, user: SessionUser) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);

  const task = await prisma.task.findUnique({
    where: { projectId_number: { projectId: project.id, number } },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      type: true,
      tags: true,
      estimateHours: true,
      dueDate: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      creatorId: true,
      assigneeId: true,
      externalId: true,
      externalSource: true,
      creator: { select: { id: true, name: true, image: true } },
      assignee: { select: { id: true, name: true, image: true } },
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          ownerId: true,
          members: {
            select: {
              userId: true,
              role: true,
              user: { select: { id: true, name: true, image: true } },
            },
          },
        },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          source: true,
          createdAt: true,
          author: { select: { id: true, name: true, image: true } },
        },
      },
      statusChanges: {
        orderBy: { changedAt: 'asc' },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          changedAt: true,
          changedById: true,
        },
      },
    },
  });

  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canViewTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  return task;
}

export type TaskDetail = Awaited<ReturnType<typeof getTask>>;
