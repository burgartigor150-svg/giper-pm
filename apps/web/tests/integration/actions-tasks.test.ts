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
  signOut: vi.fn(),
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
  createTaskAction,
  updateTaskAction,
  changeStatusAction,
  assignTaskAction,
  addCommentAction,
  deleteTaskAction,
  searchTasks,
} from '@/actions/tasks';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { addMember, makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  redirectMock.mockClear();
  vi.mocked(revalidatePath).mockClear();
  mockMe.role = 'ADMIN';
});

describe('createTaskAction', () => {
  it('creates a task and redirects', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'TST' });

    const fd = new FormData();
    fd.set('title', 'New task');

    await expect(createTaskAction('TST', null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith('/projects/TST/tasks/1');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/TST');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/TST/list');

    const tasks = await prisma.task.findMany({ where: { projectId: p.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('New task');
    expect(tasks[0]?.creatorId).toBe(u.id);
  });

  it('returns VALIDATION when title is too short', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    await makeProject({ ownerId: u.id, key: 'TST' });

    const fd = new FormData();
    fd.set('title', 'x'); // < 2 chars
    const res = await createTaskAction('TST', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.fieldErrors).toBeDefined();
    }
    expect(redirectMock).not.toHaveBeenCalled();
    expect(await prisma.task.count()).toBe(0);
  });

  it('returns NOT_FOUND when project does not exist', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('title', 'New task');
    const res = await createTaskAction('ZZZ', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when VIEWER tries to create', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const viewer = await makeUser({ role: 'VIEWER' });
    mockMe.id = viewer.id;
    mockMe.role = 'VIEWER';
    const p = await makeProject({ ownerId: owner.id, key: 'VIE' });
    await addMember(p.id, viewer.id, 'OBSERVER');

    const fd = new FormData();
    fd.set('title', 'Hello');
    const res = await createTaskAction('VIE', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns VALIDATION when assignee is not a project member', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    await makeProject({ ownerId: owner.id, key: 'AST' });

    const fd = new FormData();
    fd.set('title', 'Title');
    fd.set('assigneeId', stranger.id);
    const res = await createTaskAction('AST', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

describe('updateTaskAction', () => {
  it('updates a task (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'UPD' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id, title: 'Old' });

    const res = await updateTaskAction(t.id, 'UPD', t.number, { title: 'Updated' });
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/UPD/tasks/${t.number}`);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/UPD/list');

    const updated = await prisma.task.findUnique({ where: { id: t.id } });
    expect(updated?.title).toBe('Updated');
  });

  it('returns VALIDATION on too-short title', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'UPV' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id, title: 'Old' });

    const res = await updateTaskAction(t.id, 'UPV', t.number, { title: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const res = await updateTaskAction(
      '00000000-0000-0000-0000-000000000000',
      'X',
      1,
      { title: 'New' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS for stranger', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'NOP' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });

    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await updateTaskAction(t.id, 'NOP', t.number, { title: 'New' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('changeStatusAction', () => {
  it('changes status (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'STS' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id, status: 'TODO' });

    const res = await changeStatusAction(t.id, 'STS', t.number, 'IN_PROGRESS');
    expect(res).toEqual({ ok: true });

    const updated = await prisma.task.findUnique({ where: { id: t.id } });
    expect(updated?.status).toBe('IN_PROGRESS');
    expect(updated?.startedAt).toBeInstanceOf(Date);

    const changes = await prisma.taskStatusChange.findMany({ where: { taskId: t.id } });
    expect(changes).toHaveLength(1);
  });

  it('returns VALIDATION on bad status string', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'STV' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    const res = await changeStatusAction(t.id, 'STV', t.number, 'GARBAGE');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for unknown task', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await changeStatusAction(
      '00000000-0000-0000-0000-000000000000',
      'X',
      1,
      'DONE',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('assignTaskAction', () => {
  it('assigns a task (happy path)', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id, key: 'ASG' });
    await addMember(p.id, target.id, 'CONTRIBUTOR');
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });

    const res = await assignTaskAction(t.id, 'ASG', t.number, target.id);
    expect(res).toEqual({ ok: true });

    const updated = await prisma.task.findUnique({ where: { id: t.id } });
    expect(updated?.assigneeId).toBe(target.id);
  });

  it('unassigns a task with null', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id, key: 'ASN' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id, assigneeId: owner.id });

    const res = await assignTaskAction(t.id, 'ASN', t.number, null);
    expect(res).toEqual({ ok: true });

    const updated = await prisma.task.findUnique({ where: { id: t.id } });
    expect(updated?.assigneeId).toBe(null);
  });

  it('returns VALIDATION when assignee is non-member', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id, key: 'ASS' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });

    const res = await assignTaskAction(t.id, 'ASS', t.number, stranger.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

describe('addCommentAction', () => {
  it('adds a comment (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'CMT' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    const fd = new FormData();
    fd.set('body', 'A nice comment');

    const res = await addCommentAction(t.id, 'CMT', t.number, null, fd);
    expect(res).toEqual({ ok: true });

    const comments = await prisma.comment.findMany({ where: { taskId: t.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('A nice comment');
  });

  it('returns VALIDATION on empty body', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'CME' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    const fd = new FormData();
    fd.set('body', '');
    const res = await addCommentAction(t.id, 'CME', t.number, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(await prisma.comment.count()).toBe(0);
  });

  it('returns INSUFFICIENT_PERMISSIONS when stranger tries to comment', async () => {
    const owner = await makeUser({ role: 'PM' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'CMS' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });

    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const fd = new FormData();
    fd.set('body', 'Hi');
    const res = await addCommentAction(t.id, 'CMS', t.number, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('deleteTaskAction', () => {
  it('deletes a task and redirects', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'DEL' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    await expect(deleteTaskAction(t.id, 'DEL')).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith('/projects/DEL/list');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/DEL');

    const exists = await prisma.task.findUnique({ where: { id: t.id } });
    expect(exists).toBeNull();
  });

  it('returns NOT_FOUND for unknown task', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await deleteTaskAction('00000000-0000-0000-0000-000000000000', 'X');
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS for CONTRIBUTOR', async () => {
    const owner = await makeUser({ role: 'PM' });
    const contributor = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'DLP' });
    await addMember(p.id, contributor.id, 'CONTRIBUTOR');
    const t = await makeTask({ projectId: p.id, creatorId: contributor.id });

    mockMe.id = contributor.id;
    mockMe.role = 'MEMBER';
    const res = await deleteTaskAction(t.id, 'DLP');
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('searchTasks', () => {
  it('returns [] for queries shorter than 2 chars', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const hits = await searchTasks('a');
    expect(hits).toEqual([]);
  });

  it('returns matching tasks (ADMIN sees all)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'SRC' });
    await makeTask({ projectId: p.id, creatorId: u.id, title: 'Refactor login' });
    await makeTask({ projectId: p.id, creatorId: u.id, title: 'Fix tests' });

    const hits = await searchTasks('refactor');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe('Refactor login');
    expect(hits[0]?.projectKey).toBe('SRC');
  });

  it('MEMBER cannot see tasks of projects they are not in', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const member = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: admin.id, key: 'PRV' });
    await makeTask({ projectId: p.id, creatorId: admin.id, title: 'Secret' });

    mockMe.id = member.id;
    mockMe.role = 'MEMBER';

    const hits = await searchTasks('secret');
    expect(hits).toHaveLength(0);
  });
});
