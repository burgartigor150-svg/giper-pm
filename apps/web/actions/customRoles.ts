'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type UserRole } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { isCapabilityKey, type CapabilityKey } from '@/lib/capabilities';

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

/** Keep only real catalog keys — junk can never be stored, so it can never grant. */
function sanitizeCaps(caps: string[]): CapabilityKey[] {
  return Array.from(new Set(caps.filter(isCapabilityKey)));
}

export async function createCustomRoleAction(input: {
  name: string;
  description?: string;
  baseRole: UserRole;
  capabilities: string[];
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return DENY;
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  if (!VALID_ROLES.includes(input.baseRole)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректная базовая роль' } };
  }
  try {
    const role = await prisma.customRole.create({
      data: {
        name: name.slice(0, 80),
        description: input.description?.trim().slice(0, 500) || null,
        scope: 'ORG',
        baseRole: input.baseRole,
        capabilities: sanitizeCaps(input.capabilities),
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
  try {
    const upd = await prisma.customRole.updateMany({
      where: { id, deletedAt: null },
      data: {
        name: name.slice(0, 80),
        description: input.description?.trim().slice(0, 500) || null,
        baseRole: input.baseRole,
        capabilities: sanitizeCaps(input.capabilities),
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
