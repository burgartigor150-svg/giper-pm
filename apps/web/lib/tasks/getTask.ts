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
      bitrixSyncedAt: true,
      syncConflict: true,
      reviewerId: true,
      parentId: true,
      internalStatus: true,
      assignments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          position: true,
          user: { select: { id: true, name: true, image: true } },
        },
      },
      creator: { select: { id: true, name: true, image: true } },
      assignee: { select: { id: true, name: true, image: true } },
      reviewer: { select: { id: true, name: true, image: true } },
      parent: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          project: { select: { key: true } },
        },
      },
      subtasks: {
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priority: true,
          assignee: { select: { id: true, name: true, image: true } },
        },
      },
      blocks: {
        select: {
          id: true,
          toTask: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              project: { select: { key: true } },
            },
          },
        },
      },
      blockedBy: {
        select: {
          id: true,
          fromTask: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              project: { select: { key: true } },
            },
          },
        },
      },
      checklists: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          order: true,
          items: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              body: true,
              isDone: true,
              order: true,
            },
          },
        },
      },
      pullRequests: {
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          repo: true,
          number: true,
          title: true,
          state: true,
          url: true,
          headRef: true,
          baseRef: true,
          authorLogin: true,
          mergedAt: true,
        },
      },
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          ownerId: true,
          externalSource: true,
          externalId: true,
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
          visibility: true,
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
      attachments: {
        orderBy: { uploadedAt: 'asc' },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          uploadedAt: true,
          externalSource: true,
          externalId: true,
        },
      },
    },
  });

  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canViewTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  return task;
}

export type TaskDetail = Awaited<ReturnType<typeof getTask>>;
