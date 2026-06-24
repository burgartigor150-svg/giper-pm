import bcrypt from 'bcryptjs';
import { prisma, type UserRole, type MemberRole } from '@giper/db';
import { seedProjectStatuses } from '@/lib/status/backfillStatuses';

let counter = 0;
const next = () => ++counter;

export async function makeUser(overrides: Partial<{
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  password: string;
  mustChangePassword: boolean;
  crmAccess: boolean;
}> = {}) {
  const i = next();
  const password = overrides.password ?? 'pw-' + i;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${i}-${Date.now()}@test.local`,
      name: overrides.name ?? `User ${i}`,
      role: overrides.role ?? 'MEMBER',
      isActive: overrides.isActive ?? true,
      passwordHash: await bcrypt.hash(password, 4),
      mustChangePassword: overrides.mustChangePassword ?? false,
      crmAccess: overrides.crmAccess ?? false,
    },
  });
}

export async function makeProject(overrides: Partial<{
  key: string;
  name: string;
  ownerId: string;
}> = {}) {
  if (!overrides.ownerId) {
    throw new Error('makeProject requires ownerId');
  }
  const i = next();
  const project = await prisma.project.create({
    data: {
      key: overrides.key ?? `P${String(i).padStart(2, '0').slice(-2)}`,
      name: overrides.name ?? `Project ${i}`,
      ownerId: overrides.ownerId,
      members: {
        create: { userId: overrides.ownerId, role: 'LEAD' },
      },
    },
  });
  // Mirror createProject: seed the dynamic statuses so S2 dual-write FKs
  // (statusId / internalStatusId) resolve. Columns are NOT materialized — most
  // board tests rely on the synthesized-default render (zero BoardColumn rows).
  await seedProjectStatuses(prisma, project.id);
  return project;
}

export async function addMember(
  projectId: string,
  userId: string,
  role: MemberRole = 'CONTRIBUTOR',
) {
  return prisma.projectMember.create({
    data: { projectId, userId, role },
  });
}

export async function makeTask(overrides: Partial<{
  projectId: string;
  number: number;
  title: string;
  creatorId: string;
  assigneeId: string | null;
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';
  internalStatus: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';
}> = {}) {
  if (!overrides.projectId || !overrides.creatorId) {
    throw new Error('makeTask requires projectId and creatorId');
  }
  const max = await prisma.task.aggregate({
    where: { projectId: overrides.projectId },
    _max: { number: true },
  });
  return prisma.task.create({
    data: {
      projectId: overrides.projectId,
      number: overrides.number ?? (max._max.number ?? 0) + 1,
      title: overrides.title ?? 'Task ' + next(),
      creatorId: overrides.creatorId,
      assigneeId: overrides.assigneeId ?? null,
      status: overrides.status ?? 'TODO',
      // Omitted → DB default (BACKLOG), preserving existing tests. Set it when a
      // test exercises the internal-status track (board/list both bucket on it).
      ...(overrides.internalStatus ? { internalStatus: overrides.internalStatus } : {}),
    },
  });
}

export const sessionUser = (u: { id: string; role: UserRole }) => ({ id: u.id, role: u.role });
