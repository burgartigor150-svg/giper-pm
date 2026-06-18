import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for org-level user groups:
 *   - createGroupAction / setGroupMembersAction (ADMIN-gated).
 *   - addGroupToProjectAction bulk-adds a group's members as ProjectMembers,
 *     skipping anyone already a member.
 *
 * Source: apps/web/actions/userGroups.ts
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import {
  createGroupAction,
  setGroupMembersAction,
  addGroupToProjectAction,
} from '@/actions/userGroups';
import { makeUser, makeProject } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('user groups — admin CRUD', () => {
  it('creates a group and reconciles members', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const u1 = await makeUser();
    const u2 = await makeUser();

    const created = await createGroupAction('Дизайнеры', 'UI/UX');
    expect(created.ok).toBe(true);
    const groupId = created.ok ? created.data!.id : '';

    await setGroupMembersAction(groupId, [u1.id, u2.id]);
    let members = await prisma.userGroupMember.findMany({ where: { groupId } });
    expect(members).toHaveLength(2);

    // Reconcile down to one.
    await setGroupMembersAction(groupId, [u1.id]);
    members = await prisma.userGroupMember.findMany({ where: { groupId } });
    expect(members.map((m) => m.userId)).toEqual([u1.id]);
  });

  it('forbids a non-admin from creating a group', async () => {
    const u = await makeUser({ role: 'MEMBER' });
    mockMe.id = u.id;
    mockMe.role = 'MEMBER';
    const res = await createGroupAction('Нельзя');
    expect(res.ok).toBe(false);
  });

  it('rejects a duplicate group name', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const a = await createGroupAction('Уникальная');
    expect(a.ok).toBe(true);
    const b = await createGroupAction('Уникальная');
    expect(b.ok).toBe(false);
  });
});

describe('addGroupToProjectAction', () => {
  it('bulk-adds group members as project members, skipping existing', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const u1 = await makeUser();
    const u2 = await makeUser();

    const created = await createGroupAction('Команда');
    const groupId = created.ok ? created.data!.id : '';
    await setGroupMembersAction(groupId, [u1.id, u2.id]);

    // Project owned by admin; owner is auto-member (LEAD) via the factory.
    const project = await makeProject({ ownerId: admin.id });

    const res = await addGroupToProjectAction(groupId, project.id, 'CONTRIBUTOR');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data?.added).toBe(2);

    const members = await prisma.projectMember.findMany({ where: { projectId: project.id } });
    // owner (LEAD) + u1 + u2
    expect(members.length).toBe(3);

    // Re-running adds nothing new.
    const again = await addGroupToProjectAction(groupId, project.id, 'CONTRIBUTOR');
    expect(again.ok && again.data?.added).toBe(0);
  });
});
