import bcrypt from 'bcryptjs';
import { prisma, type UserRole, type MemberRole } from '@giper/db';

let counter = 0;
const next = () => ++counter;

export async function makeUser(overrides: Partial<{
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  password: string;
  mustChangePassword: boolean;
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
  return prisma.project.create({
    data: {
      key: overrides.key ?? `P${String(i).padStart(2, '0').slice(-2)}`,
      name: overrides.name ?? `Project ${i}`,
      ownerId: overrides.ownerId,
      members: {
        create: { userId: overrides.ownerId, role: 'LEAD' },
      },
    },
  });
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
    },
  });
}

export const sessionUser = (u: { id: string; role: UserRole }) => ({ id: u.id, role: u.role });
