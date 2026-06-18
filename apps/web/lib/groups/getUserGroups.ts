import { prisma } from '@giper/db';

export type UserGroupSummary = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
};

export type UserGroupDetail = {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
};

/** All user groups with member counts, for the admin list. Fault-tolerant. */
export async function getUserGroups(): Promise<UserGroupSummary[]> {
  try {
    const groups = await prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { members: true } },
      },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: g._count.members,
    }));
  } catch (e) {
    console.warn('getUserGroups: unavailable', e);
    return [];
  }
}

/** One group with its member user ids. Returns null if missing. */
export async function getUserGroup(groupId: string): Promise<UserGroupDetail | null> {
  try {
    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        description: true,
        members: { select: { userId: true } },
      },
    });
    if (!group) return null;
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      memberIds: group.members.map((m) => m.userId),
    };
  } catch (e) {
    console.warn('getUserGroup: unavailable', e);
    return null;
  }
}
