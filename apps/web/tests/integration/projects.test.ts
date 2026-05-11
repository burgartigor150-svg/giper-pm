import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { DomainError } from '@/lib/errors';
import {
  createProject,
  updateProject,
  archiveProject,
  listProjectsForUser,
  getProject,
  addProjectMember,
  removeProjectMember,
} from '@/lib/projects';
import { makeUser, makeProject, makeTask, addMember, sessionUser } from './helpers/factories';

const baseInput = {
  name: 'Some Project',
  description: undefined,
  client: undefined,
  deadline: undefined,
  budgetHours: undefined,
  hourlyRate: undefined,
};

async function expectDomain(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'DomainError', code });
}

describe('createProject', () => {
  it('ADMIN creates → returns key, owner is set, LEAD member auto-added', async () => {
    const admin = await makeUser({ role: 'ADMIN' });

    const p = await createProject(
      { ...baseInput, key: 'AA', name: 'Alpha' },
      sessionUser(admin),
    );

    expect(p.key).toBe('AA');
    expect(p.ownerId).toBe(admin.id);

    const members = await prisma.projectMember.findMany({ where: { projectId: p.id } });
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(admin.id);
    expect(members[0]!.role).toBe('LEAD');
  });

  it('PM creates → ok', async () => {
    const pm = await makeUser({ role: 'PM' });
    const p = await createProject(
      { ...baseInput, key: 'BB', name: 'Beta' },
      sessionUser(pm),
    );
    expect(p.ownerId).toBe(pm.id);
  });

  it.each([
    ['MEMBER', 'CC'],
    ['VIEWER', 'DD'],
  ] as const)('%s → INSUFFICIENT_PERMISSIONS (status=403)', async (role, key) => {
    const u = await makeUser({ role });
    try {
      await createProject({ ...baseInput, key, name: 'X' }, sessionUser(u));
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('INSUFFICIENT_PERMISSIONS');
      expect((e as DomainError).status).toBe(403);
    }
  });

  it('duplicate key → CONFLICT (status=409)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await createProject({ ...baseInput, key: 'EE', name: 'E1' }, sessionUser(admin));
    try {
      await createProject({ ...baseInput, key: 'EE', name: 'E2' }, sessionUser(admin));
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('CONFLICT');
      expect((e as DomainError).status).toBe(409);
    }
  });
});

describe('updateProject', () => {
  it('owner can edit', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    const updated = await updateProject(
      p.id,
      { ...baseInput, name: 'New Name' },
      sessionUser(owner),
    );
    expect(updated.name).toBe('New Name');
  });

  it('ADMIN can edit any project', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id });
    const updated = await updateProject(
      p.id,
      { ...baseInput, name: 'Admin Edit' },
      sessionUser(admin),
    );
    expect(updated.name).toBe('Admin Edit');
  });

  it('LEAD member can edit', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const lead = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, lead.id, 'LEAD');
    const updated = await updateProject(
      p.id,
      { ...baseInput, name: 'Lead Edit' },
      sessionUser(lead),
    );
    expect(updated.name).toBe('Lead Edit');
  });

  it('CONTRIBUTOR member CANNOT edit', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const contrib = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, contrib.id, 'CONTRIBUTOR');
    await expectDomain(
      updateProject(p.id, { ...baseInput, name: 'Nope' }, sessionUser(contrib)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('non-existent project → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      updateProject('nope-id', { ...baseInput, name: 'x' }, sessionUser(admin)),
      'NOT_FOUND',
    );
  });

  it('status update applied when provided', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    const updated = await updateProject(
      p.id,
      { ...baseInput, name: p.name, status: 'ON_HOLD' },
      sessionUser(owner),
    );
    expect(updated.status).toBe('ON_HOLD');
  });
});

describe('archiveProject', () => {
  it('owner can archive — sets status=ARCHIVED + archivedAt', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    const archived = await archiveProject(p.id, sessionUser(owner));
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.archivedAt).toBeInstanceOf(Date);
  });

  it('ADMIN can archive any', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id });
    expect((await archiveProject(p.id, sessionUser(admin))).status).toBe('ARCHIVED');
  });

  it('LEAD can archive; CONTRIBUTOR cannot', async () => {
    const owner = await makeUser();
    const lead = await makeUser();
    const c = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, lead.id, 'LEAD');
    await addMember(p.id, c.id, 'CONTRIBUTOR');
    await expectDomain(archiveProject(p.id, sessionUser(c)), 'INSUFFICIENT_PERMISSIONS');
    expect((await archiveProject(p.id, sessionUser(lead))).status).toBe('ARCHIVED');
  });

  it('non-existent → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(archiveProject('missing', sessionUser(admin)), 'NOT_FOUND');
  });
});

describe('listProjectsForUser', () => {
  it('ADMIN scope=all sees all (including projects they don’t own)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    await makeProject({ ownerId: stranger.id, key: 'AA' });
    await makeProject({ ownerId: stranger.id, key: 'AB' });
    const list = await listProjectsForUser(sessionUser(admin), { scope: 'all' });
    expect(list).toHaveLength(2);
  });

  it('ADMIN scope=mine sees only projects where THEY have a task stake', async () => {
    // Visibility is per-stake even for ADMIN. Owning a project alone
    // isn't enough — there has to be at least one task with assignee
    // ∈ {me, my team} (or an unassigned task I created).
    const admin = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const mine = await makeProject({ ownerId: admin.id, key: 'AC' });
    await makeProject({ ownerId: stranger.id, key: 'AD' });
    await makeTask({ projectId: mine.id, creatorId: admin.id, assigneeId: admin.id });
    const list = await listProjectsForUser(sessionUser(admin), { scope: 'mine' });
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('AC');
  });

  it('MEMBER scope=all is ignored — only stake-of-mine visible', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const stranger = await makeUser({ role: 'MEMBER' });
    await makeProject({ ownerId: stranger.id, key: 'AE' });
    const mine = await makeProject({ ownerId: owner.id, key: 'AF' });
    // Owner needs a task to surface the project in the per-stake list.
    await makeTask({ projectId: mine.id, creatorId: owner.id, assigneeId: owner.id });
    const list = await listProjectsForUser(sessionUser(owner), { scope: 'all' });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(mine.id);
  });

  it('MEMBER sees projects where a task is assigned to them', async () => {
    // ProjectMember alone no longer surfaces the project — task-level
    // stake does. This matches how Bitrix-mirror groups work: no
    // ProjectMember rows, just task assignees.
    const owner = await makeUser();
    const member = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    await makeTask({ projectId: p.id, creatorId: owner.id, assigneeId: member.id });
    const list = await listProjectsForUser(sessionUser(member));
    expect(list).toHaveLength(1);
  });

  it('member of empty project does NOT see it (no task stake)', async () => {
    // Bitrix-mirror workgroup with zero tasks should be hidden — owning
    // it or being a member without any task assignment buys nothing.
    const owner = await makeUser();
    const member = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    expect(await listProjectsForUser(sessionUser(member))).toHaveLength(0);
  });

  it('includeArchived=false (default) hides ARCHIVED', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const live = await makeProject({ ownerId: owner.id, key: 'AG' });
    const dead = await makeProject({ ownerId: owner.id, key: 'AH' });
    await makeTask({ projectId: live.id, creatorId: owner.id, assigneeId: owner.id });
    await makeTask({ projectId: dead.id, creatorId: owner.id, assigneeId: owner.id });
    await prisma.project.update({
      where: { id: dead.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const list = await listProjectsForUser(sessionUser(owner));
    expect(list.map((x) => x.id)).toEqual([live.id]);
  });

  it('status filter applies and overrides default ARCHIVED hiding', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const live = await makeProject({ ownerId: owner.id, key: 'AI' });
    const dead = await makeProject({ ownerId: owner.id, key: 'AJ' });
    await makeTask({ projectId: live.id, creatorId: owner.id, assigneeId: owner.id });
    await makeTask({ projectId: dead.id, creatorId: owner.id, assigneeId: owner.id });
    await prisma.project.update({
      where: { id: dead.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const list = await listProjectsForUser(sessionUser(owner), { status: 'ARCHIVED' });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(dead.id);
  });

  it('VIEWER sees the project iff they have a task stake in it', async () => {
    const owner = await makeUser();
    const v = await makeUser({ role: 'VIEWER' });
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, v.id, 'OBSERVER');
    await makeTask({ projectId: p.id, creatorId: owner.id, assigneeId: v.id });
    const list = await listProjectsForUser(sessionUser(v));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(p.id);
  });
});

describe('getProject', () => {
  it('member, owner, and PM-member can all view; PM stranger CANNOT', async () => {
    // Visibility is per-stake — PM role does NOT bypass project
    // membership. A PM gets in only when they're owner, ProjectMember,
    // or have a task stake in the project.
    const owner = await makeUser();
    const m = await makeUser();
    const pmMember = await makeUser({ role: 'PM' });
    const pmStranger = await makeUser({ role: 'PM' });
    const p = await makeProject({ ownerId: owner.id, key: 'GP' });
    await addMember(p.id, m.id, 'CONTRIBUTOR');
    await addMember(p.id, pmMember.id, 'LEAD');
    expect((await getProject(p.key, sessionUser(owner))).id).toBe(p.id);
    expect((await getProject(p.key, sessionUser(m))).id).toBe(p.id);
    expect((await getProject(p.key, sessionUser(pmMember))).id).toBe(p.id);
    await expectDomain(getProject(p.key, sessionUser(pmStranger)), 'INSUFFICIENT_PERMISSIONS');
  });

  it('non-member MEMBER → INSUFFICIENT_PERMISSIONS', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'GR' });
    await expectDomain(getProject(p.key, sessionUser(stranger)), 'INSUFFICIENT_PERMISSIONS');
  });

  it('user with implicit task-stake (Bitrix mirror) sees the project', async () => {
    const owner = await makeUser();
    const bxUser = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'GBX' });
    // No ProjectMember row — just an assigned task, like a Bitrix
    // workgroup we synced where membership is implicit in tasks.
    await makeTask({ projectId: p.id, creatorId: owner.id, assigneeId: bxUser.id });
    expect((await getProject(p.key, sessionUser(bxUser))).id).toBe(p.id);
  });

  it('non-existent → NOT_FOUND', async () => {
    const a = await makeUser({ role: 'ADMIN' });
    await expectDomain(getProject('NOPE', sessionUser(a)), 'NOT_FOUND');
  });
});

describe('addProjectMember', () => {
  it('LEAD adds new member → ok', async () => {
    const owner = await makeUser();
    const newbie = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    const m = await addProjectMember(
      p.id,
      { userId: newbie.id, role: 'CONTRIBUTOR' },
      sessionUser(owner),
    );
    expect(m.userId).toBe(newbie.id);
    expect(m.role).toBe('CONTRIBUTOR');
  });

  it('already-member → CONFLICT', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, m.id, 'CONTRIBUTOR');
    await expectDomain(
      addProjectMember(p.id, { userId: m.id, role: 'REVIEWER' }, sessionUser(owner)),
      'CONFLICT',
    );
  });

  it('non-existent user → NOT_FOUND', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await expectDomain(
      addProjectMember(p.id, { userId: 'no-such-user', role: 'CONTRIBUTOR' }, sessionUser(owner)),
      'NOT_FOUND',
    );
  });

  it('inactive user → NOT_FOUND', async () => {
    const owner = await makeUser();
    const inactive = await makeUser({ isActive: false });
    const p = await makeProject({ ownerId: owner.id });
    await expectDomain(
      addProjectMember(p.id, { userId: inactive.id, role: 'CONTRIBUTOR' }, sessionUser(owner)),
      'NOT_FOUND',
    );
  });

  it('non-LEAD member cannot add', async () => {
    const owner = await makeUser();
    const c = await makeUser();
    const newbie = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, c.id, 'CONTRIBUTOR');
    await expectDomain(
      addProjectMember(p.id, { userId: newbie.id, role: 'CONTRIBUTOR' }, sessionUser(c)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('non-existent project → NOT_FOUND', async () => {
    const a = await makeUser({ role: 'ADMIN' });
    const target = await makeUser();
    await expectDomain(
      addProjectMember('no-id', { userId: target.id, role: 'CONTRIBUTOR' }, sessionUser(a)),
      'NOT_FOUND',
    );
  });
});

describe('removeProjectMember', () => {
  it('LEAD removes member → ok', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, m.id, 'CONTRIBUTOR');
    const result = await removeProjectMember(p.id, m.id, sessionUser(owner));
    expect(result.count).toBe(1);
    const remaining = await prisma.projectMember.findMany({
      where: { projectId: p.id, userId: m.id },
    });
    expect(remaining).toHaveLength(0);
  });

  it('cannot remove owner → VALIDATION', async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id });
    await expectDomain(
      removeProjectMember(p.id, owner.id, sessionUser(admin)),
      'VALIDATION',
    );
  });

  it('random user cannot remove', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, m.id, 'CONTRIBUTOR');
    await expectDomain(
      removeProjectMember(p.id, m.id, sessionUser(stranger)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('non-existent project → NOT_FOUND', async () => {
    const a = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      removeProjectMember('no-such', 'no-user', sessionUser(a)),
      'NOT_FOUND',
    );
  });
});
