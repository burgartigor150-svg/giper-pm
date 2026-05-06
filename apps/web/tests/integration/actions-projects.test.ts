import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  signOut: vi.fn(async () => {
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;/login';
    throw e;
  }),
  signIn: vi.fn(),
}));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;' + url;
    throw e;
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  createProjectAction,
  updateProjectAction,
  archiveProjectAction,
  addProjectMemberAction,
  removeProjectMemberAction,
} from '@/actions/projects';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { addMember, makeProject, makeUser } from './helpers/factories';

beforeEach(() => {
  redirectMock.mockClear();
  vi.mocked(revalidatePath).mockClear();
  mockMe.role = 'ADMIN';
});

// ----- createProjectAction --------------------------------------------------

describe('createProjectAction', () => {
  it('creates a project (happy path) and redirects', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('name', 'Hello world');
    fd.set('key', 'HELLO');

    await expect(createProjectAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith('/projects/HELLO');
    expect(revalidatePath).toHaveBeenCalledWith('/projects');

    const created = await prisma.project.findUnique({ where: { key: 'HELLO' } });
    expect(created?.name).toBe('Hello world');
    expect(created?.ownerId).toBe(u.id);
    const members = await prisma.projectMember.findMany({ where: { projectId: created!.id } });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('LEAD');
  });

  it('returns VALIDATION on missing name', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('key', 'PRJ');
    const res = await createProjectAction(null, fd);
    expect(res).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'VALIDATION' }),
      }),
    );
    if (res.ok === false) {
      expect(res.error.fieldErrors).toBeDefined();
    }
    const count = await prisma.project.count();
    expect(count).toBe(0);
  });

  it('returns VALIDATION on bad key (lowercase)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('name', 'Project A');
    fd.set('key', 'a'); // too short / invalid
    const res = await createProjectAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns INSUFFICIENT_PERMISSIONS when MEMBER tries to create', async () => {
    const u = await makeUser({ role: 'MEMBER' });
    mockMe.id = u.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('name', 'Nope');
    fd.set('key', 'NOPE');
    const res = await createProjectAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when key already exists', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    await makeProject({ key: 'DUP', ownerId: u.id });

    const fd = new FormData();
    fd.set('name', 'Another');
    fd.set('key', 'DUP');
    const res = await createProjectAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CONFLICT');
  });
});

// ----- updateProjectAction --------------------------------------------------

describe('updateProjectAction', () => {
  it('updates project (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, name: 'Old' });

    const fd = new FormData();
    fd.set('name', 'New name');

    const res = await updateProjectAction(p.id, null, fd);
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/projects');

    const updated = await prisma.project.findUnique({ where: { id: p.id } });
    expect(updated?.name).toBe('New name');
  });

  it('returns VALIDATION when name too short', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, name: 'Old name' });

    const fd = new FormData();
    fd.set('name', 'x'); // < 2 chars

    const res = await updateProjectAction(p.id, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');

    const project = await prisma.project.findUnique({ where: { id: p.id } });
    expect(project?.name).toBe('Old name');
  });

  it('returns NOT_FOUND for missing project', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('name', 'New name');

    const res = await updateProjectAction('00000000-0000-0000-0000-000000000000', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when MEMBER (non-LEAD) tries to update', async () => {
    const owner = await makeUser({ role: 'PM' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';

    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    const fd = new FormData();
    fd.set('name', 'New name');
    const res = await updateProjectAction(p.id, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

// ----- archiveProjectAction --------------------------------------------------

describe('archiveProjectAction', () => {
  it('archives a project (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id });

    const res = await archiveProjectAction(p.id);
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/projects');

    const archived = await prisma.project.findUnique({ where: { id: p.id } });
    expect(archived?.status).toBe('ARCHIVED');
    expect(archived?.archivedAt).toBeInstanceOf(Date);
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await archiveProjectAction('00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when non-LEAD CONTRIBUTOR archives', async () => {
    const owner = await makeUser({ role: 'PM' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';

    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    const res = await archiveProjectAction(p.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

// ----- addProjectMemberAction ----------------------------------------------

describe('addProjectMemberAction', () => {
  it('adds a member (happy path)', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });

    const res = await addProjectMemberAction(p.id, { userId: target.id, role: 'CONTRIBUTOR' });
    expect(res).toEqual({ ok: true });

    const members = await prisma.projectMember.findMany({ where: { projectId: p.id } });
    expect(members.find((m) => m.userId === target.id)?.role).toBe('CONTRIBUTOR');
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('returns VALIDATION on bad role', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });

    const res = await addProjectMemberAction(p.id, {
      userId: target.id,
      role: 'NOT_A_ROLE' as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for missing target user', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });

    const res = await addProjectMemberAction(p.id, {
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'CONTRIBUTOR',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when adding existing member', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    const res = await addProjectMemberAction(p.id, { userId: member.id, role: 'REVIEWER' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CONFLICT');
  });
});

// ----- removeProjectMemberAction --------------------------------------------

describe('removeProjectMemberAction', () => {
  it('removes member (happy path)', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    const res = await removeProjectMemberAction(p.id, member.id);
    expect(res).toEqual({ ok: true });

    const remaining = await prisma.projectMember.findMany({
      where: { projectId: p.id, userId: member.id },
    });
    expect(remaining).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('returns VALIDATION when trying to remove owner', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });

    const res = await removeProjectMemberAction(p.id, owner.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for missing project', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await removeProjectMemberAction('00000000-0000-0000-0000-000000000000', u.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS for non-LEAD MEMBER', async () => {
    const owner = await makeUser({ role: 'PM' });
    const m1 = await makeUser({ role: 'MEMBER' });
    const m2 = await makeUser({ role: 'MEMBER' });
    mockMe.id = m1.id;
    mockMe.role = 'MEMBER';
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, m1.id, 'CONTRIBUTOR');
    await addMember(p.id, m2.id, 'CONTRIBUTOR');

    const res = await removeProjectMemberAction(p.id, m2.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});
