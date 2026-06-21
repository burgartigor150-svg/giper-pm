'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import {
  createVersionSchema,
  updateVersionSchema,
  versionStatusSchema,
  type CreateVersionInput,
  type UpdateVersionInput,
  type VersionStatusInput,
} from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject, canEditTaskInternal, type ProjectForPerm } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const ROW_PROJECT_SELECT = {
  id: true,
  key: true,
  ownerId: true,
  members: { select: { userId: true, role: true } },
} as const;

function revalidateReleases(projectKey: string) {
  revalidatePath(`/projects/${projectKey}/releases`);
  revalidatePath(`/projects/${projectKey}/board`);
  revalidatePath(`/projects/${projectKey}/list`);
}

/** Resolve + project-edit gate, reusing the per-project capability overlay. */
async function requireProjectEdit(
  me: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' },
  project: ProjectForPerm & { id: string },
) {
  const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id);
  return canEditProject({ id: me.id, role: me.role }, project, caps);
}

/** Create a PLANNED version. Gated on project-edit. */
export async function createVersionAction(
  input: CreateVersionInput,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const parsed = createVersionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректные данные' } };
  }
  const data = parsed.data;

  let project;
  try {
    project = await getProject(data.projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: 'Нет доступа к проекту' } };
    throw e;
  }
  if (!(await requireProjectEdit(me, project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const created = await prisma.version.create({
    data: {
      projectId: project.id,
      name: data.name,
      description: data.description ?? null,
      releaseDate: data.releaseDate ?? null,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidateReleases(data.projectKey);
  return { ok: true, data: { id: created.id } };
}

export async function updateVersionAction(
  id: string,
  input: UpdateVersionInput,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = updateVersionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректные данные' } };
  }
  const data = parsed.data;
  const row = await prisma.version.findUnique({ where: { id }, select: { id: true, project: { select: ROW_PROJECT_SELECT } } });
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Версия не найдена' } };
  if (!(await requireProjectEdit(me, row.project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.version.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.releaseDate !== undefined ? { releaseDate: data.releaseDate } : {}),
    },
  });
  revalidateReleases(row.project.key);
  return { ok: true };
}

/** Move a version's lifecycle. Stamps releasedAt on the move to RELEASED. */
export async function setVersionStatusAction(
  id: string,
  status: VersionStatusInput,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsedStatus = versionStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Недопустимый статус' } };
  }
  const row = await prisma.version.findUnique({
    where: { id },
    select: { id: true, releasedAt: true, project: { select: ROW_PROJECT_SELECT } },
  });
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Версия не найдена' } };
  if (!(await requireProjectEdit(me, row.project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.version.update({
    where: { id },
    data: {
      status: parsedStatus.data,
      // First time it ships, stamp releasedAt; don't overwrite an earlier stamp.
      ...(parsedStatus.data === 'RELEASED' && !row.releasedAt ? { releasedAt: new Date() } : {}),
    },
  });
  revalidateReleases(row.project.key);
  return { ok: true };
}

/** Delete a version. Its cards keep existing (Task.versionId SetNull). Idempotent. */
export async function deleteVersionAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  const row = await prisma.version.findUnique({ where: { id }, select: { id: true, project: { select: ROW_PROJECT_SELECT } } });
  if (!row) return { ok: true };
  if (!(await requireProjectEdit(me, row.project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.version.delete({ where: { id } });
  revalidateReleases(row.project.key);
  return { ok: true };
}

/**
 * Slate a card for a version (or clear with null). Local-only field, gated by
 * canEditTaskInternal (works on Bitrix-mirror cards) — mirrors the sprint
 * assignment. The version must belong to the card's project.
 */
export async function setTaskVersionAction(
  taskId: string,
  versionId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      number: true,
      creatorId: true,
      assigneeId: true,
      project: { select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId);
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task, caps)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (versionId) {
    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { projectId: true } });
    if (!version || version.projectId !== task.projectId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Версия не из этого проекта' } };
    }
  }
  await prisma.task.update({ where: { id: taskId }, data: { versionId } });
  revalidatePath(`/projects/${task.project.key}/tasks/${task.number}`);
  revalidatePath(`/projects/${task.project.key}/releases`);
  return { ok: true };
}
