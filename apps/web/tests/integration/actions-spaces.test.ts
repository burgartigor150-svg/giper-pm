import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for Spaces (additive project grouping): CRUD + assign +
 * delete-ungroups, RBAC, and the load-bearing invariant — grouping by space
 * NEVER widens project visibility (listProjectsForUser is unchanged).
 *
 * Source: apps/web/actions/spaces.ts, lib/spaces/getSpaces.ts,
 *         lib/projects/listProjectsForUser.ts
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
  createSpaceAction,
  deleteSpaceAction,
  reorderSpacesAction,
  setProjectSpaceAction,
} from '@/actions/spaces';
import { getSpaces } from '@/lib/spaces/getSpaces';
import { listProjectsForUser } from '@/lib/projects/listProjectsForUser';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('spaces — CRUD & assignment', () => {
  it('creates a space and lists it with a project count', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await createSpaceAction('Маркетинг', 'отдел');
    expect(res.ok).toBe(true);
    const spaceId = res.ok ? res.data!.id : '';

    const project = await makeProject({ ownerId: admin.id });
    await setProjectSpaceAction(project.key, spaceId);

    const spaces = await getSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0]?.projectCount).toBe(1);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(p.spaceId).toBe(spaceId);
  });

  it('drag-reorder (reorderSpacesAction) persists the new order', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const a = await createSpaceAction('Альфа');
    const b = await createSpaceAction('Бета');
    const c = await createSpaceAction('Гамма');
    const ids = [a, b, c].map((r) => (r.ok ? r.data!.id : ''));
    // Initial order = creation order.
    expect((await getSpaces()).map((s) => s.id)).toEqual(ids);

    // Drag Гамма to the front (what the DnD onDragEnd sends).
    const reordered = [ids[2], ids[0], ids[1]] as string[];
    expect((await reorderSpacesAction(reordered)).ok).toBe(true);
    expect((await getSpaces()).map((s) => s.id)).toEqual(reordered);
  });

  it('drag to "Без пространства" (setProjectSpaceAction null) ungroups the project', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await createSpaceAction('Производство');
    const spaceId = res.ok ? res.data!.id : '';
    const project = await makeProject({ ownerId: admin.id });
    await setProjectSpaceAction(project.key, spaceId);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).spaceId).toBe(spaceId);

    // Dropping into the "Без пространства" bucket sends spaceId = null.
    expect((await setProjectSpaceAction(project.key, null)).ok).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).spaceId).toBeNull();
  });

  it('deleting a space ungroups its projects (SetNull), not deletes them', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await createSpaceAction('Времянка');
    const spaceId = res.ok ? res.data!.id : '';
    const project = await makeProject({ ownerId: admin.id });
    await setProjectSpaceAction(project.key, spaceId);

    await deleteSpaceAction(spaceId);

    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(p.spaceId).toBeNull(); // ungrouped, still exists
  });

  it('forbids a MEMBER from creating a space', async () => {
    mockMe.id = (await makeUser({ role: 'MEMBER' })).id;
    mockMe.role = 'MEMBER';
    expect((await createSpaceAction('Нельзя')).ok).toBe(false);
  });

  it('forbids assigning a project you cannot edit', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const s = await createSpaceAction('S1');
    const spaceId = s.ok ? s.data!.id : '';
    // A plain MEMBER who is not on the project cannot file it into a space.
    mockMe.id = (await makeUser({ role: 'MEMBER' })).id;
    mockMe.role = 'MEMBER';
    expect((await setProjectSpaceAction(project.key, spaceId)).ok).toBe(false);
  });
});

describe('spaces — visibility invariant', () => {
  it('grouping by space never widens project visibility', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const space = await createSpaceAction('Закрытое');
    const spaceId = space.ok ? space.data!.id : '';
    const project = await makeProject({ ownerId: owner.id });
    await setProjectSpaceAction(project.key, spaceId);
    // listProjectsForUser scope 'mine' = visibility by task-stake (not bare
    // ownership), so give the owner a stake to make the project appear.
    await makeTask({ projectId: project.id, creatorId: owner.id });

    // Owner sees their spaced project (with space populated).
    const ownerList = await listProjectsForUser({ id: owner.id, role: 'ADMIN' });
    const seen = ownerList.find((p) => p.id === project.id);
    expect(seen?.space?.id).toBe(spaceId);

    // A stranger with no stake does NOT see it, space or not.
    const stranger = await makeUser({ role: 'MEMBER' });
    const strangerList = await listProjectsForUser({ id: stranger.id, role: 'MEMBER' });
    expect(strangerList.some((p) => p.id === project.id)).toBe(false);

    // A user with a task stake DOES see it (and its space) — same rule as before.
    const collaborator = await makeUser({ role: 'MEMBER' });
    await makeTask({ projectId: project.id, creatorId: collaborator.id });
    const collabList = await listProjectsForUser({ id: collaborator.id, role: 'MEMBER' });
    expect(collabList.find((p) => p.id === project.id)?.space?.id).toBe(spaceId);
  });
});
