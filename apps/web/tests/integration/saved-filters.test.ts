import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Saved filters (Jira-port #1): create/update/delete/setDefault gate matrix +
 * listSavedFiltersForView visibility + the security regression guard that the
 * expanded filter dimensions never bypass the per-stake access clause.
 */

const mockMe = { id: '', role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER', name: 'A', email: 'a@a', image: null, mustChangePassword: false };
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import {
  createSavedFilterAction,
  updateSavedFilterAction,
  deleteSavedFilterAction,
  setDefaultSavedFilterAction,
} from '@/actions/savedFilters';
import {
  listSavedFiltersForView,
  resolveDefaultFilterQuery,
} from '@/lib/savedFilters/listSavedFiltersForView';
import { listTasksForProject } from '@/lib/tasks';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(user: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = user.id;
  mockMe.role = user.role;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('saved filters — create gate', () => {
  it('persists a private preset for the owner; the query round-trips normalized', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFA' });
    as(admin);
    const res = await createSavedFilterAction({
      projectKey: p.key,
      scope: 'LIST',
      name: 'Срочные',
      query: 'priority=HIGH&page=4&q=foo',
    });
    expect(res.ok).toBe(true);
    const id = res.ok ? res.data!.id : '';
    const row = await prisma.savedFilter.findUniqueOrThrow({ where: { id } });
    expect(row.query).toBe('priority=HIGH&q=foo'); // page dropped + sorted
    expect(row.isShared).toBe(false);
    expect(row.userId).toBe(admin.id);
  });

  it('a MEMBER cannot create a SHARED preset, but a private one succeeds', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFB' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    as(member);

    const shared = await createSavedFilterAction({
      projectKey: p.key, scope: 'BOARD', name: 'Общий', query: 'priority=HIGH', isShared: true,
    });
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.error.code).toBe('INSUFFICIENT_PERMISSIONS');

    const priv = await createSavedFilterAction({
      projectKey: p.key, scope: 'BOARD', name: 'Личный', query: 'priority=HIGH',
    });
    expect(priv.ok).toBe(true);
  });

  it('a LEAD can publish a shared preset', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFC' });
    const lead = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, lead.id, 'LEAD');
    as(lead);
    const res = await createSavedFilterAction({
      projectKey: p.key, scope: 'BOARD', name: 'Командный', query: 'priority=URGENT', isShared: true,
    });
    expect(res.ok).toBe(true);
  });

  it('a non-member (no stake) is rejected by the project view floor', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFD' });
    const outsider = await makeUser({ role: 'MEMBER' });
    as(outsider);
    const res = await createSavedFilterAction({
      projectKey: p.key, scope: 'LIST', name: 'Чужой', query: 'priority=HIGH',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects a query with an unknown param key', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFE' });
    as(admin);
    const res = await createSavedFilterAction({
      projectKey: p.key, scope: 'LIST', name: 'Плохой', query: 'evil=1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

describe('saved filters — default + list visibility', () => {
  it('single-default per (user, project, scope): a second default clears the first', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFF' });
    as(admin);
    const a = await createSavedFilterAction({ projectKey: p.key, scope: 'LIST', name: 'Фильтр A', query: 'priority=HIGH', isDefault: true });
    const b = await createSavedFilterAction({ projectKey: p.key, scope: 'LIST', name: 'Фильтр B', query: 'priority=LOW', isDefault: true });
    const defaults = await prisma.savedFilter.findMany({ where: { userId: admin.id, projectId: p.id, scope: 'LIST', isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(b.ok ? b.data!.id : '');
    // resolveDefaultFilterQuery returns the surviving default's query
    expect(await resolveDefaultFilterQuery(p.key, 'LIST', admin.id)).toBe('priority=LOW');
    // an unrelated scope has no default
    expect(await resolveDefaultFilterQuery(p.key, 'BOARD', admin.id)).toBeNull();
    void a;
  });

  it('lists own presets + shared presets, never another user\'s private one; isMine correct', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFG' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    // admin publishes a shared preset + keeps a private one
    as(admin);
    await createSavedFilterAction({ projectKey: p.key, scope: 'BOARD', name: 'Общий', query: 'priority=HIGH', isShared: true });
    await createSavedFilterAction({ projectKey: p.key, scope: 'BOARD', name: 'Личный админа', query: 'priority=LOW' });
    // member has their own private preset
    as(member);
    await createSavedFilterAction({ projectKey: p.key, scope: 'BOARD', name: 'Личный участника', query: 'q=x' });

    const seen = await listSavedFiltersForView(p.id, 'BOARD', member.id);
    const names = seen.map((s) => s.name).sort();
    expect(names).toEqual(['Личный участника', 'Общий']); // NOT "Личный админа"
    const shared = seen.find((s) => s.name === 'Общий')!;
    expect(shared.isMine).toBe(false);
    const own = seen.find((s) => s.name === 'Личный участника')!;
    expect(own.isMine).toBe(true);
  });
});

describe('saved filters — delete gate', () => {
  it('owner deletes own; LEAD prunes shared; a member cannot delete another\'s private; missing id is idempotent', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFH' });
    const lead = await makeUser({ role: 'MEMBER' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, lead.id, 'LEAD');
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    // member's private preset
    as(member);
    const ownRes = await createSavedFilterAction({ projectKey: p.key, scope: 'LIST', name: 'Свой', query: 'q=a' });
    const ownId = ownRes.ok ? ownRes.data!.id : '';
    // admin's shared preset
    as(admin);
    const sharedRes = await createSavedFilterAction({ projectKey: p.key, scope: 'LIST', name: 'Общий', query: 'q=b', isShared: true });
    const sharedId = sharedRes.ok ? sharedRes.data!.id : '';

    // lead (not owner) cannot delete member's PRIVATE preset
    as(lead);
    const denied = await deleteSavedFilterAction(ownId);
    expect(denied.ok).toBe(false);

    // lead CAN prune the shared preset (canEditProject)
    const pruned = await deleteSavedFilterAction(sharedId);
    expect(pruned.ok).toBe(true);
    expect(await prisma.savedFilter.findUnique({ where: { id: sharedId } })).toBeNull();

    // owner deletes their own
    as(member);
    expect((await deleteSavedFilterAction(ownId)).ok).toBe(true);

    // missing id idempotent
    expect((await deleteSavedFilterAction('nonexistent')).ok).toBe(true);
  });

  it('setDefault is owner-only', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFI' });
    const other = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, other.id, 'LEAD');
    as(admin);
    const r = await createSavedFilterAction({ projectKey: p.key, scope: 'LIST', name: 'Общий пресет', query: 'q=a', isShared: true });
    const id = r.ok ? r.data!.id : '';
    // even a LEAD cannot default someone else's row
    as(other);
    const denied = await setDefaultSavedFilterAction(id, true);
    expect(denied.ok).toBe(false);
  });
});

describe('expanded filter dims — SECURITY: per-stake clause preserved', () => {
  it('type/dueWithin/reviewer filters never surface a task the viewer has no stake on', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFSEC' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR'); // member can VIEW project but tasks are per-stake

    // task1: admin-only, no stake for rep, type BUG
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: t1.id }, data: { type: 'BUG' } });
    // task2: rep is the assignee, type BUG
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: rep.id });
    await prisma.task.update({ where: { id: t2.id }, data: { type: 'BUG' } });

    const res = await listTasksForProject(
      p.key,
      { type: 'BUG', page: 1, sort: 'number', dir: 'desc' },
      { id: rep.id, role: 'MEMBER' },
    );
    const ids = res.items.map((i) => i.id);
    expect(ids).toContain(t2.id); // rep's own task matches
    expect(ids).not.toContain(t1.id); // no-stake task stays hidden despite matching type
  });

  it('reviewer=me returns only tasks the viewer reviews; dueWithin=overdue only past-due open tasks', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SFDIM' });
    const rep = await makeUser({ role: 'MEMBER' });

    // reviewer task (rep is reviewer → a stake)
    const reviewT = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: reviewT.id }, data: { reviewerId: rep.id } });
    // overdue task assigned to rep, still open
    const overdueT = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: rep.id, status: 'TODO' });
    await prisma.task.update({
      where: { id: overdueT.id },
      data: { dueDate: new Date(Date.now() - 86_400_000), status: 'TODO', internalStatus: 'TODO' },
    });
    // future-due task assigned to rep
    const futureT = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: rep.id, status: 'TODO' });
    await prisma.task.update({
      where: { id: futureT.id },
      data: { dueDate: new Date(Date.now() + 7 * 86_400_000) },
    });

    const reviewed = await listTasksForProject(
      p.key, { reviewer: 'me', page: 1, sort: 'number', dir: 'desc' }, { id: rep.id, role: 'MEMBER' },
    );
    expect(reviewed.items.map((i) => i.id)).toEqual([reviewT.id]);

    const overdue = await listTasksForProject(
      p.key, { dueWithin: 'overdue', page: 1, sort: 'number', dir: 'desc' }, { id: rep.id, role: 'MEMBER' },
    );
    const overdueIds = overdue.items.map((i) => i.id);
    expect(overdueIds).toContain(overdueT.id);
    expect(overdueIds).not.toContain(futureT.id);
  });
});
