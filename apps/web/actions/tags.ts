'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { fanoutToTaskAudience } from '@/lib/notifications/createNotifications';

/**
 * Per-project tags. Permission model:
 *   - listing tags of a project: any project member or admin
 *   - creating new tags: any project member or admin
 *   - assign/unassign on a task: anyone who can edit the task internally
 *     (this includes Bitrix-mirror tasks because tags are an internal
 *     concept that doesn't round-trip)
 */

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const PALETTE = [
  '#94a3b8', // slate
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
];

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tag';
}

function pickColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? '#94a3b8';
}

async function assertProjectAccess(projectId: string, userId: string, role: string) {
  if (role === 'ADMIN') return true;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { userId: true },
  });
  return !!member;
}

export async function listTagsForProject(projectId: string) {
  const me = await requireAuth();
  const ok = await assertProjectAccess(projectId, me.id, me.role);
  if (!ok) return [];
  return prisma.tag.findMany({
    where: { projectId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, color: true, externalSource: true },
  });
}

export async function createTagAction(
  projectId: string,
  name: string,
  color?: string,
): Promise<ActionResult<{ id: string; name: string; slug: string; color: string }>> {
  const me = await requireAuth();
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название тега пустое' } };
  }
  if (trimmed.length > 40) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не длиннее 40 символов' } };
  }
  const ok = await assertProjectAccess(projectId, me.id, me.role);
  if (!ok) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет доступа к проекту' } };
  }
  const slug = slugify(trimmed);
  const finalColor = color ?? pickColorFor(trimmed);
  try {
    const tag = await prisma.tag.create({
      data: { projectId, name: trimmed, slug, color: finalColor },
      select: { id: true, name: true, slug: true, color: true },
    });
    return { ok: true, data: tag };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Same slug exists — return the existing one so the picker can
      // assign it directly (idempotent UX).
      const existing = await prisma.tag.findUnique({
        where: { projectId_slug: { projectId, slug } },
        select: { id: true, name: true, slug: true, color: true },
      });
      if (existing) return { ok: true, data: existing };
    }
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось создать тег' } };
  }
}

async function loadTaskWithProject(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      project: {
        select: {
          id: true,
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
}

export async function assignTagToTaskAction(
  taskId: string,
  tagId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await loadTaskWithProject(taskId);
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task)) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав' } };
  }
  // Make sure tag belongs to the same project — prevents tag IDs from
  // other projects sneaking in via crafted requests.
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { id: true, projectId: true },
  });
  if (!tag || tag.projectId !== task.project.id) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Тег не найден в этом проекте' } };
  }
  const existing = await prisma.taskTag.findUnique({
    where: { taskId_tagId: { taskId, tagId } },
    select: { taskId: true },
  });
  await prisma.taskTag.upsert({
    where: { taskId_tagId: { taskId, tagId } },
    create: { taskId, tagId, assignedById: me.id },
    update: {},
  });
  // Notify the task's audience only on a NEW assignment (upsert that
  // updates an existing row would be a no-op spam).
  if (!existing) {
    const tagName = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { name: true },
    });
    await fanoutToTaskAudience(taskId, me.id, {
      kind: 'TASK_STATUS_CHANGED',
      title: `${me.name ?? 'Кто-то'} добавил(а) тег «${tagName?.name ?? ''}»`,
      link: `/projects/${task.project.key}/tasks/${taskId}`,
      payload: { taskId, tagId, projectKey: task.project.key },
    });
  }
  revalidatePath(`/projects/${task.project.key}/tasks/${taskId}`);
  revalidatePath(`/projects/${task.project.key}/board`);
  revalidatePath(`/projects/${task.project.key}`);
  return { ok: true };
}

export async function unassignTagFromTaskAction(
  taskId: string,
  tagId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await loadTaskWithProject(taskId);
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task)) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Нет прав' } };
  }
  await prisma.taskTag
    .delete({ where: { taskId_tagId: { taskId, tagId } } })
    .catch(() => null); // already gone is fine
  revalidatePath(`/projects/${task.project.key}/tasks/${taskId}`);
  revalidatePath(`/projects/${task.project.key}/board`);
  revalidatePath(`/projects/${task.project.key}`);
  return { ok: true };
}

export async function deleteTagAction(
  projectId: string,
  tagId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== me.id) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Только владелец/ADMIN' } };
    }
  }
  await prisma.tag.delete({ where: { id: tagId } }).catch(() => null);
  revalidatePath(`/projects`);
  return { ok: true };
}
