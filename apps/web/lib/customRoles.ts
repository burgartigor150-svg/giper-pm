import { prisma, type UserRole, type CustomRoleScope } from '@giper/db';
import { isCapabilityKey, type CapabilityKey } from '@/lib/capabilities';

export type CustomRoleRow = {
  id: string;
  name: string;
  description: string | null;
  baseRole: UserRole;
  scope: CustomRoleScope;
  capabilities: CapabilityKey[];
  isActive: boolean;
  assignedCount: number;
};

const cleanCaps = (caps: string[]): CapabilityKey[] => caps.filter(isCapabilityKey);

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  baseRole: true,
  scope: true,
  capabilities: true,
  isActive: true,
  _count: { select: { assignments: true, projectAssignments: true } },
} as const;

type RoleSelectRow = {
  id: string;
  name: string;
  description: string | null;
  baseRole: UserRole;
  scope: CustomRoleScope;
  capabilities: string[];
  isActive: boolean;
  _count: { assignments: number; projectAssignments: number };
};

const toRow = (r: RoleSelectRow): CustomRoleRow => ({
  id: r.id,
  name: r.name,
  description: r.description,
  baseRole: r.baseRole,
  scope: r.scope,
  capabilities: cleanCaps(r.capabilities),
  isActive: r.isActive,
  // ORG roles count org assignments; PROJECT roles count per-project ones.
  assignedCount: r.scope === 'PROJECT' ? r._count.projectAssignments : r._count.assignments,
});

/** All non-deleted custom roles (ORG + PROJECT) with assignment counts. Fault-tolerant. */
export async function listCustomRoles(): Promise<CustomRoleRow[]> {
  try {
    const rows = await prisma.customRole.findMany({
      where: { deletedAt: null },
      orderBy: [{ scope: 'asc' }, { isActive: 'desc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
    return rows.map(toRow);
  } catch (e) {
    console.warn('listCustomRoles: unavailable', e);
    return [];
  }
}

/** A single non-deleted custom role (any scope), or null. */
export async function getCustomRole(id: string): Promise<CustomRoleRow | null> {
  const r = await prisma.customRole.findFirst({
    where: { id, deletedAt: null },
    select: ROLE_SELECT,
  });
  return r ? toRow(r) : null;
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

/** Active ORG roles for the org assignment selector (id + name). */
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

/** Active PROJECT-scope roles for the per-project assignment selector. */
export async function listProjectAssignableRoles(): Promise<{ id: string; name: string }[]> {
  try {
    return await prisma.customRole.findMany({
      where: { deletedAt: null, isActive: true, scope: 'PROJECT' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  } catch {
    return [];
  }
}

/** All per-project role assignments in one project → userId→roleId map. Fault-tolerant. */
export async function listProjectMemberAssignments(projectId: string): Promise<Map<string, string>> {
  try {
    const rows = await prisma.projectMemberCustomRole.findMany({
      where: { projectId },
      select: { userId: true, customRoleId: true },
    });
    return new Map(rows.map((r) => [r.userId, r.customRoleId]));
  } catch {
    return new Map();
  }
}

/** A user's current per-project custom-role assignment in one project, or null. */
export async function getProjectMemberAssignment(
  projectId: string,
  userId: string,
): Promise<{ roleId: string; roleName: string } | null> {
  try {
    const row = await prisma.projectMemberCustomRole.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { customRoleId: true, customRole: { select: { name: true } } },
    });
    if (!row) return null;
    return { roleId: row.customRoleId, roleName: row.customRole.name };
  } catch {
    return null;
  }
}
