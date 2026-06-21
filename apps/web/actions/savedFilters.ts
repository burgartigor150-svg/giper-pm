'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import {
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type CreateSavedFilterInput,
  type UpdateSavedFilterInput,
} from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

function revalidateViews(projectKey: string) {
  revalidatePath(`/projects/${projectKey}/board`);
  revalidatePath(`/projects/${projectKey}/list`);
}

/** Project shape the canEditProject gate needs, loaded with a SavedFilter row. */
const ROW_PROJECT_SELECT = {
  id: true,
  key: true,
  ownerId: true,
  members: { select: { userId: true, role: true } },
} as const;

/**
 * Save the current board/list filter as a named preset. A preset is private to
 * its owner unless `isShared`. Gate: must be able to VIEW the project (per-stake
 * floor via getProject); publishing a SHARED preset additionally requires
 * canEditProject (owner / LEAD / project.edit cap). The query is validated +
 * normalized by the schema, so a preset can never smuggle unknown params.
 */
export async function createSavedFilterAction(
  input: CreateSavedFilterInput,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const parsed = createSavedFilterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректные данные' },
    };
  }
  const data = parsed.data;

  // View floor — only on a project you can see may you save a preset.
  let project;
  try {
    project = await getProject(data.projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, error: { code: e.code, message: 'Нет доступа к проекту' } };
    }
    throw e;
  }

  if (data.isShared) {
    const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id);
    if (!canEditProject({ id: me.id, role: me.role }, project, caps)) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только владелец/лид проекта может создать общий пресет' },
      };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    // Single-default per (user, project, scope) — no partial unique index under
    // db push, so enforce it transactionally (mirror startSprintAction).
    if (data.isDefault) {
      await tx.savedFilter.updateMany({
        where: { userId: me.id, projectId: project.id, scope: data.scope, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.savedFilter.create({
      data: {
        userId: me.id,
        projectId: project.id,
        scope: data.scope,
        name: data.name,
        query: data.query,
        isShared: data.isShared,
        isDefault: data.isDefault,
      },
      select: { id: true },
    });
  });

  revalidateViews(data.projectKey);
  return { ok: true, data: { id: created.id } };
}

/**
 * Rename / re-query / (un)publish a preset. The row owner may always edit their
 * own preset; editing someone else's (shared) preset requires canEditProject.
 * Flipping `isShared` ON is publishing → requires canEditProject even for the
 * owner.
 */
export async function updateSavedFilterAction(
  id: string,
  input: UpdateSavedFilterInput,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = updateSavedFilterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректные данные' },
    };
  }
  const data = parsed.data;

  const row = await prisma.savedFilter.findUnique({
    where: { id },
    select: { id: true, userId: true, isShared: true, project: { select: ROW_PROJECT_SELECT } },
  });
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пресет не найден' } };

  const isOwner = row.userId === me.id;
  if (!isOwner) {
    // A non-owner may only edit a SHARED preset, and only with project-edit —
    // another user's PRIVATE preset is off-limits.
    if (!row.isShared) {
      return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
    }
    const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, row.project.id);
    if (!canEditProject({ id: me.id, role: me.role }, row.project, caps)) {
      return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
    }
  }
  // Publishing (isShared false→true) requires project-edit even for the owner.
  if (data.isShared === true && !row.isShared) {
    const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, row.project.id);
    if (!canEditProject({ id: me.id, role: me.role }, row.project, caps)) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только владелец/лид проекта может опубликовать пресет' },
      };
    }
  }

  await prisma.savedFilter.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.query !== undefined ? { query: data.query } : {}),
      ...(data.isShared !== undefined ? { isShared: data.isShared } : {}),
    },
  });
  revalidateViews(row.project.key);
  return { ok: true };
}

/**
 * Delete a preset. The owner deletes their own; a project lead (canEditProject)
 * may prune a shared preset. Idempotent — a missing row returns ok.
 */
export async function deleteSavedFilterAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  const row = await prisma.savedFilter.findUnique({
    where: { id },
    select: { id: true, userId: true, isShared: true, project: { select: ROW_PROJECT_SELECT } },
  });
  if (!row) return { ok: true };

  if (row.userId !== me.id) {
    // A non-owner may only prune a SHARED preset, and only with project-edit.
    // Another user's PRIVATE preset is never theirs to delete (they can't even
    // see it in the list).
    if (!row.isShared) {
      return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
    }
    const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, row.project.id);
    if (!canEditProject({ id: me.id, role: me.role }, row.project, caps)) {
      return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
    }
  }
  await prisma.savedFilter.delete({ where: { id } });
  revalidateViews(row.project.key);
  return { ok: true };
}

/**
 * Set / clear a preset as the owner's default for its (scope) in this project.
 * Owner-only: a default is a personal preference, never imposed by an admin and
 * never set on a row you don't own. Single-default enforced transactionally.
 */
export async function setDefaultSavedFilterAction(
  id: string,
  makeDefault: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  const row = await prisma.savedFilter.findUnique({
    where: { id },
    select: { id: true, userId: true, scope: true, projectId: true, project: { select: { key: true } } },
  });
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пресет не найден' } };
  if (row.userId !== me.id) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'По умолчанию можно сделать только свой пресет' },
    };
  }

  await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.savedFilter.updateMany({
        where: { userId: me.id, projectId: row.projectId, scope: row.scope, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    await tx.savedFilter.update({ where: { id }, data: { isDefault: makeDefault } });
  });
  revalidateViews(row.project.key);
  return { ok: true };
}
