import { prisma, type UserRole } from '@giper/db';
import { isCapabilityKey, type CapabilityKey } from '@/lib/capabilities';

export type CustomRoleRow = {
  id: string;
  name: string;
  description: string | null;
  baseRole: UserRole;
  capabilities: CapabilityKey[];
  isActive: boolean;
  assignedCount: number;
};

const cleanCaps = (caps: string[]): CapabilityKey[] => caps.filter(isCapabilityKey);

/** All non-deleted ORG custom roles with assignment counts. Fault-tolerant. */
export async function listCustomRoles(): Promise<CustomRoleRow[]> {
  try {
    const rows = await prisma.customRole.findMany({
      where: { deletedAt: null, scope: 'ORG' },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        baseRole: true,
        capabilities: true,
        isActive: true,
        _count: { select: { assignments: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      baseRole: r.baseRole,
      capabilities: cleanCaps(r.capabilities),
      isActive: r.isActive,
      assignedCount: r._count.assignments,
    }));
  } catch (e) {
    console.warn('listCustomRoles: unavailable', e);
    return [];
  }
}

/** A single non-deleted ORG custom role, or null. */
export async function getCustomRole(id: string): Promise<CustomRoleRow | null> {
  const r = await prisma.customRole.findFirst({
    where: { id, deletedAt: null, scope: 'ORG' },
    select: {
      id: true,
      name: true,
      description: true,
      baseRole: true,
      capabilities: true,
      isActive: true,
      _count: { select: { assignments: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    baseRole: r.baseRole,
    capabilities: cleanCaps(r.capabilities),
    isActive: r.isActive,
    assignedCount: r._count.assignments,
  };
}

/** The user's current ORG custom-role assignment, or null. */
export async function getUserAssignment(
  userId: string,
): Promise<{ roleId: string; roleName: string } | null> {
  try {
    const row = await prisma.userCustomRole.findUnique({
      where: { userId },
      select: { customRoleId: true, customRole: { select: { name: true } } },
    });
    if (!row) return null;
    return { roleId: row.customRoleId, roleName: row.customRole.name };
  } catch {
    return null;
  }
}

/** Active roles for the assignment selector (id + name). */
export async function listAssignableRoles(): Promise<{ id: string; name: string }[]> {
  try {
    return await prisma.customRole.findMany({
      where: { deletedAt: null, isActive: true, scope: 'ORG' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  } catch {
    return [];
  }
}
