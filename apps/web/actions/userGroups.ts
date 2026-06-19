'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

async function requireAdmin() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') return null;
  return me;
}

/** Create a new org-level user group (ADMIN only). */
export async function createGroupAction(
  name: string,
  description = '',
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только админ' } };
  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  try {
    const group = await prisma.userGroup.create({
      data: { name: clean.slice(0, 80), description: description.trim().slice(0, 500), createdById: me.id },
      select: { id: true },
    });
    revalidatePath('/settings/groups');
    return { ok: true, data: { id: group.id } };
  } catch (e) {
    // Unique name violation is the common case.
    return { ok: false, error: { code: 'CONFLICT', message: 'Группа с таким названием уже есть' } };
  }
}

/** Rename / re-describe a group (ADMIN only). */
export async function updateGroupAction(
  groupId: string,
  name: string,
  description: string,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только админ' } };
  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  try {
    await prisma.userGroup.update({
      where: { id: groupId },
      data: { name: clean.slice(0, 80), description: description.trim().slice(0, 500) },
    });
    revalidatePath('/settings/groups');
    revalidatePath(`/settings/groups/${groupId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'CONFLICT', message: 'Название занято или группа не найдена' } };
  }
}

/** Delete a group (ADMIN only). Members rows cascade; project memberships stay. */
export async function deleteGroupAction(groupId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только админ' } };
  try {
    await prisma.userGroup.delete({ where: { id: groupId } });
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Группа не найдена или не удалось удалить' } };
  }
  revalidatePath('/settings/groups');
  return { ok: true };
}

/** Reconcile a group's full member set (ADMIN only). */
export async function setGroupMembersAction(
  groupId: string,
  userIds: string[],
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только админ' } };
  const group = await prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) return { ok: false, error: { code: 'NOT_FOUND', message: 'Группа не найдена' } };

  const wanted = new Set(userIds);
  const existing = await prisma.userGroupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toAdd = [...wanted].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !wanted.has(id));

  await prisma.$transaction([
    ...(toRemove.length
      ? [prisma.userGroupMember.deleteMany({ where: { groupId, userId: { in: toRemove } } })]
      : []),
    ...(toAdd.length
      ? [
          prisma.userGroupMember.createMany({
            data: toAdd.map((userId) => ({ groupId, userId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  revalidatePath(`/settings/groups/${groupId}`);
  revalidatePath('/settings/groups');
  return { ok: true };
}

/**
 * Bulk-add every member of a group to a project as ProjectMember rows
 * (skipping anyone already a member). Gated on project-edit permission —
 * a project LEAD/owner/PM/ADMIN can pull in a whole group at once.
 */
export async function addGroupToProjectAction(
  groupId: string,
  projectId: string,
  role: 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER' = 'CONTRIBUTOR',
): Promise<ActionResult<{ added: number }>> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const members = await prisma.userGroupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  const existing = new Set(project.members.map((m) => m.userId));
  const toAdd = members.map((m) => m.userId).filter((id) => !existing.has(id));
  if (toAdd.length === 0) return { ok: true, data: { added: 0 } };

  await prisma.projectMember.createMany({
    data: toAdd.map((userId) => ({ projectId, userId, role })),
    skipDuplicates: true,
  });
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true, data: { added: toAdd.length } };
}
