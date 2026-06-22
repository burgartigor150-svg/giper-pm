'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type Position, type TaskStatus } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import { isTransitionAllowed } from '@/lib/workflow/isTransitionAllowed';
import {
  createNotification,
  fanoutToTaskAudience,
} from '@/lib/notifications/createNotifications';
import { autoUnblockDependents } from '@/lib/tasks/autoTransitions';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { runColumnEnterAutomations } from '@/lib/automations/runColumnEnterAutomations';
import { dispatchWebhooks } from '@/lib/webhooks/dispatchWebhooks';
import { canManageAssignments } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const ALL_POSITIONS: Position[] = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE',
  'QA', 'QA_AUTO',
  'DESIGNER', 'UX',
  'ANALYST', 'BA',
  'PM', 'LEAD',
  'DEVOPS', 'SRE',
  'CONTENT', 'MARKETING',
  'OTHER',
];
function isPosition(s: string): s is Position {
  return (ALL_POSITIONS as string[]).includes(s);
}

/**
 * Add a person to a task as an additional assignee in a specific role.
 * Distinct from the legacy single Task.assigneeId which still backs the
 * Bitrix mirror — we never touch that here. Multiple people per role
 * are allowed (two BACKEND devs paired up on a feature is normal).
 *
 * Permission: anyone who can edit the task can manage assignments.
 */
export async function addTaskAssignmentAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  userId: string,
  rawPosition: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!isPosition(rawPosition)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Невалидная роль' } };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  // Resource management is a PM concern. Regular contributors (incl.
  // creator/assignee) cannot put other people on a task.
  if (!canManageAssignments({ id: me.id, role: me.role }, task.project, await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId))) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только PM/лид может назначать соисполнителей' },
    };
  }

  try {
    await prisma.taskAssignment.create({
      data: {
        taskId,
        userId,
        position: rawPosition,
        createdById: me.id,
      },
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      // Already assigned in this role — idempotent ok.
      return { ok: true };
    }
    throw e;
  }
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  if (userId !== me.id) {
    await createNotification({
      userId,
      kind: 'TASK_ASSIGNED',
      title: `${me.name ?? 'Кто-то'} назначил(а) вас соисполнителем`,
      link,
      payload: { taskId, projectKey, taskNumber, position: rawPosition },
    });
  }
  await fanoutToTaskAudience(
    taskId,
    me.id,
    {
      kind: 'TASK_STATUS_CHANGED',
      title: `${me.name ?? 'Кто-то'} добавил(а) соисполнителя`,
      link,
      payload: { taskId, projectKey, taskNumber, addedUserId: userId },
    },
    { excludeUserIds: [userId] },
  );
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

export async function removeTaskAssignmentAction(
  assignmentId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const a = await prisma.taskAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      task: {
        select: {
          id: true,
          projectId: true,
          creatorId: true,
          assigneeId: true,
          externalSource: true,
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true, role: true } },
            },
          },
        },
      },
    },
  });
  if (!a) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  if (!canManageAssignments({ id: me.id, role: me.role }, a.task.project, await getEffectiveCapsForProject({ id: me.id, role: me.role }, a.task.projectId))) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только PM/лид может снимать соисполнителей' },
    };
  }
  await prisma.taskAssignment.delete({ where: { id: assignmentId } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

/**
 * Change the *internal* status of a task — independent from the Bitrix-
 * mirror `status` field, which the existing changeStatusAction owns.
 * Same lifecycle bookkeeping as the mirror (startedAt / completedAt)
 * but on dedicated fields would be over-engineering — we leave those
 * alone and only update internalStatus here.
 *
 * Permission mirrors canEditTask but explicitly *allows* edits on
 * Bitrix-mirrored tasks: that's the whole reason we have this track.
 */
export async function setInternalStatusAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  rawStatus: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    // Shared core (also used by the MCP server) — gate, workflow-transition
    // check, update, and side effects all live there.
    await setInternalStatus(taskId, rawStatus, me);
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    throw e;
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { ok: true };
}

/** Set or clear a task's story points (0–999, null clears). */
export async function setStoryPointsAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  rawPoints: number | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const allow =
    me.role === 'ADMIN' ||
    me.role === 'PM' ||
    task.creatorId === me.id ||
    task.assigneeId === me.id ||
    task.project.ownerId === me.id ||
    task.project.members.some((m) => m.userId === me.id && m.role === 'LEAD');
  if (!allow) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  let points: number | null = null;
  if (rawPoints != null) {
    const n = Math.floor(Number(rawPoints));
    if (Number.isFinite(n) && n >= 0 && n <= 999) points = n;
  }
  await prisma.task.update({ where: { id: taskId }, data: { storyPoints: points } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { ok: true };
}

