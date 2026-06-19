'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject, canSeeSettings } from '@/lib/permissions';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DENY = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } } as const;

/** Create a space (ADMIN/PM). */
export async function createSpaceAction(name: string, description = ''): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) return DENY;
  if (name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  const max = await prisma.space.aggregate({ where: { archivedAt: null }, _max: { order: true } });
  const space = await prisma.space.create({
    data: {
      name: name.trim().slice(0, 120),
      description: description.trim().slice(0, 1000) || null,
      order: (max._max.order ?? -1) + 1,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/settings');
  revalidatePath('/projects');
  return { ok: true, data: { id: space.id } };
}

/** Rename / re-describe a space (ADMIN/PM). */
export async function renameSpaceAction(spaceId: string, name: string, description: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) return DENY;
  if (name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  try {
    await prisma.space.update({
      where: { id: spaceId },
      data: { name: name.trim().slice(0, 120), description: description.trim().slice(0, 1000) || null },
    });
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Пространство не найдено или не удалось сохранить' } };
  }
  revalidatePath('/settings');
  revalidatePath('/projects');
  return { ok: true };
}

/** Delete a space (ADMIN/PM). Its projects are ungrouped (FK SetNull), not deleted. */
export async function deleteSpaceAction(spaceId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) return DENY;
  try {
    await prisma.space.delete({ where: { id: spaceId } });
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Пространство не найдено или не удалось удалить' } };
  }
  revalidatePath('/settings');
  revalidatePath('/projects');
  return { ok: true };
}

/** Set the display order of spaces (ADMIN/PM). */
export async function reorderSpacesAction(orderedIds: string[]): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) return DENY;
  try {
    await prisma.$transaction(
      orderedIds.map((id, i) => prisma.space.update({ where: { id }, data: { order: i } })),
    );
  } catch {
    return { ok: false, error: { code: 'DB_ERROR', message: 'Не удалось изменить порядок' } };
  }
  revalidatePath('/settings');
  revalidatePath('/projects');
  return { ok: true };
}

/**
 * Assign a project to a space (or ungroup with spaceId=null). Gated on
 * project-edit permission — a project owner/LEAD/PM/ADMIN can file their own
 * project into a space.
 */
export async function setProjectSpaceAction(projectKey: string, spaceId: string | null): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (spaceId) {
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } });
    if (!space) return { ok: false, error: { code: 'VALIDATION', message: 'Пространство не найдено' } };
  }
  await prisma.project.update({ where: { id: project.id }, data: { spaceId } });
  revalidatePath('/projects');
  revalidatePath(`/projects/${projectKey}/settings`);
  return { ok: true };
}
