'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type UserRole, type CustomRoleScope } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { isCapabilityKey, isProjectCapKey, getEffectiveCaps, type CapabilityKey } from '@/lib/capabilities';
import { canEditProject } from '@/lib/permissions';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DENY = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только админ' } } as const;

/**
 * Role management is gated on the FIXED ADMIN role (requireAuth + role check),
 * NOT on a capability — so a custom role can never grant itself the power to
 * manage roles (no privilege-escalation through the role system itself).
 */
async function requireAdmin() {
  const me = await requireAuth();
  return me.role === 'ADMIN' ? me : null;
}

const VALID_ROLES: UserRole[] = ['ADMIN', 'PM', 'MEMBER', 'VIEWER'];

/** Keep only real catalog keys — junk can never be stored, so it can never grant.
 *  PROJECT-scope roles are additionally narrowed to the project/task subset, so
 *  an org-surface key can never be smuggled into a per-project role (write-layer
 *  guard #1 of 3; the resolver + merge layers also contain it). */
function sanitizeForScope(caps: string[], scope: CustomRoleScope): CapabilityKey[] {
  const clean = caps.filter(isCapabilityKey);
  const scoped = scope === 'PROJECT' ? clean.filter(isProjectCapKey) : clean;
  return Array.from(new Set(scoped));
}

const VALID_SCOPES: CustomRoleScope[] = ['ORG', 'PROJECT'];

export async function createCustomRoleAction(input: {
  name: string;
  description?: string;
  baseRole: UserRole;
  capabilities: string[];
  scope?: CustomRoleScope;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return DENY;
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  if (!VALID_ROLES.includes(input.baseRole)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректная базовая роль' } };
  }
  const scope: CustomRoleScope = input.scope && VALID_SCOPES.includes(input.scope) ? input.scope : 'ORG';
  try {
    const role = await prisma.customRole.create({
      data: {
        name: name.slice(0, 80),
        description: input.description?.trim().slice(0, 500) || null,
        scope,
        baseRole: input.baseRole,
        capabilities: sanitizeForScope(input.capabilities, scope),
        createdById: me.id,
      },
      select: { id: true },
    });
    revalidatePath('/settings/roles');
    return { ok: true, data: { id: role.id } };
  } catch {
    return { ok: false, error: { code: 'CONFLICT', message: 'Роль с таким названием уже есть' } };
  }
}

export async function updateCustomRoleAction(
  id: string,
  input: { name: string; description?: string; baseRole: UserRole; capabilities: string[] },
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return DENY;
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  if (!VALID_ROLES.includes(input.baseRole)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректная базовая роль' } };
  }
  // Re-derive the cap subset from the role's STORED scope (scope is immutable
  // after create) so a PROJECT role can't be widened to org keys via update.
  const existing = await prisma.customRole.findFirst({ where: { id, deletedAt: null }, select: { scope: true } });
  if (!existing) return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
  try {
    const upd = await prisma.customRole.updateMany({
      where: { id, deletedAt: null },
      data: {
        name: name.slice(0, 80),
        description: input.description?.trim().slice(0, 500) || null,
        baseRole: input.baseRole,
        capabilities: sanitizeForScope(input.capabilities, existing.scope),
      },
    });
    if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
    revalidatePath('/settings/roles');
    revalidatePath(`/settings/roles/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'CONFLICT', message: 'Роль с таким названием уже есть' } };
  }
}

/** Enable/disable a role without unassigning. Disabled → assignees revert to baseline. */
export async function setCustomRoleActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return DENY;
  const upd = await prisma.customRole.updateMany({ where: { id, deletedAt: null }, data: { isActive } });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
  revalidatePath('/settings/roles');
  revalidatePath(`/settings/roles/${id}`);
  return { ok: true };
}

/** Soft-delete a role; cascades unassign its holders (back to baseline). */
export async function deleteCustomRoleAction(id: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return DENY;
  try {
    await prisma.$transaction([
      prisma.userCustomRole.deleteMany({ where: { customRoleId: id } }),
      // PROJECT assignments are soft-delete-orphaned otherwise (FK cascades only
      // on hard delete); loadProjectCaps's deletedAt check is the backstop, but
      // clear them so the row count + re-add behavior stay clean.
      prisma.projectMemberCustomRole.deleteMany({ where: { customRoleId: id } }),
      prisma.customRole.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } }),
    ]);
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
  }
  revalidatePath('/settings/roles');
  return { ok: true };
}

/**
 * Assign (or, with roleId=null, unassign) an ORG custom role to a user. One role
 * per user (the @unique userId makes this an upsert). ADMIN only.
 */
export async function assignCustomRoleAction(userId: string, roleId: string | null): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return DENY;
  try {
    if (!roleId) {
      await prisma.userCustomRole.deleteMany({ where: { userId } });
    } else {
      const role = await prisma.customRole.findFirst({
        where: { id: roleId, deletedAt: null, scope: 'ORG' },
        select: { id: true },
      });
      if (!role) return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
      await prisma.userCustomRole.upsert({
        where: { userId },
        create: { userId, customRoleId: roleId, assignedById: me.id },
        update: { customRoleId: roleId, assignedById: me.id, assignedAt: new Date() },
      });
    }
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось назначить роль' } };
  }
  revalidatePath('/settings/roles');
  revalidatePath(`/settings/users/${userId}`);
  return { ok: true };
}

/**
 * Assign (or, with roleId=null, unassign) a PROJECT-scope custom role to a user
 * WITHIN one project. Unlike the org assign, this is gated on canEditProject for
 * the target project — so a project owner/LEAD (or org project.edit) can assign,
 * matching "admin/project-lead". Hard floors: the assignee must already be a
 * formal ProjectMember (or owner) of the project, and the role must be scope
 * PROJECT. One role per (project, user).
 */
export async function assignProjectCustomRoleAction(
  projectId: string,
  userId: string,
  roleId: string | null,
  projectKey: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  // Authz: owner / LEAD / org project.edit ONLY (ORG caps, NOT per-project) —
  // assigning project roles is meta-management; authorizing it via a per-project
  // capability would let a project-role holder grant roles (self-escalation).
  if (!canEditProject({ id: me.id, role: me.role }, project, await getEffectiveCaps({ id: me.id, role: me.role }))) {
    return DENY;
  }
  // Membership floor: a per-project role can only attach to someone who can
  // already SEE the project via a formal membership (== canViewProject leg #2),
  // never via the Bitrix/task-stake legs.
  const isMember = project.ownerId === userId || project.members.some((m) => m.userId === userId);
  if (!isMember) {
    return { ok: false, error: { code: 'NOT_A_MEMBER', message: 'Сначала добавьте пользователя в проект' } };
  }
  try {
    if (!roleId) {
      await prisma.projectMemberCustomRole.deleteMany({ where: { projectId, userId } });
    } else {
      const role = await prisma.customRole.findFirst({
        where: { id: roleId, deletedAt: null, scope: 'PROJECT' },
        select: { id: true },
      });
      if (!role) return { ok: false, error: { code: 'NOT_FOUND', message: 'Роль не найдена' } };
      await prisma.projectMemberCustomRole.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId, customRoleId: roleId },
        update: { customRoleId: roleId, assignedAt: new Date() },
      });
    }
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось назначить роль' } };
  }
  revalidatePath(`/projects/${projectKey}/settings`);
  return { ok: true };
}
