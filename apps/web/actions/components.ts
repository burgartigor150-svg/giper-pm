'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import {
  createComponentSchema,
  updateComponentSchema,
  type CreateComponentInput,
  type UpdateComponentInput,
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

function revalidateComponents(projectKey: string) {
  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}/board`);
  revalidatePath(`/projects/${projectKey}/list`);
}

async function requireProjectEdit(
  me: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' },
  project: ProjectForPerm & { id: string },
) {
  const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id);
  return canEditProject({ id: me.id, role: me.role }, project, caps);
}

/** A lead, if given, must be a real user — else store null (FK-safe + graceful). */
async function resolveLead(leadId: string | null | undefined): Promise<string | null> {
  if (!leadId) return null;
  const u = await prisma.user.findUnique({ where: { id: leadId }, select: { id: true } });
  return u ? u.id : null;
}

export async function createComponentAction(
  input: CreateComponentInput,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const parsed = createComponentSchema.safeParse(input);
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

  const created = await prisma.component.create({
    data: {
      projectId: project.id,
      name: data.name,
      description: data.description ?? null,
      leadId: await resolveLead(data.leadId),
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidateComponents(data.projectKey);
  return { ok: true, data: { id: created.id } };
}

export async function updateComponentAction(
  id: string,
  input: UpdateComponentInput,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = updateComponentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректные данные' } };
  }
  const data = parsed.data;
  const row = await prisma.component.findUnique({ where: { id }, select: { id: true, project: { select: ROW_PROJECT_SELECT } } });
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Компонент не найден' } };
  if (!(await requireProjectEdit(me, row.project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.component.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.leadId !== undefined ? { leadId: await resolveLead(data.leadId) } : {}),
    },
  });
  revalidateComponents(row.project.key);
  return { ok: true };
}

/** Delete a component. Its cards keep existing (Task.componentId SetNull). Idempotent. */
export async function deleteComponentAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  const row = await prisma.component.findUnique({ where: { id }, select: { id: true, project: { select: ROW_PROJECT_SELECT } } });
  if (!row) return { ok: true };
  if (!(await requireProjectEdit(me, row.project))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.component.delete({ where: { id } });
  revalidateComponents(row.project.key);
  return { ok: true };
}

/**
 * Assign a card to a component (or clear with null). Local-only field, gated by
 * canEditTaskInternal (mirrors version/sprint assignment). The component must
 * belong to the card's project.
 */
export async function setTaskComponentAction(
  taskId: string,
  componentId: string | null,
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
  if (componentId) {
    const c = await prisma.component.findUnique({ where: { id: componentId }, select: { projectId: true } });
    if (!c || c.projectId !== task.projectId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Компонент не из этого проекта' } };
    }
  }
  await prisma.task.update({ where: { id: taskId }, data: { componentId } });
  revalidatePath(`/projects/${task.project.key}/tasks/${task.number}`);
  return { ok: true };
}
