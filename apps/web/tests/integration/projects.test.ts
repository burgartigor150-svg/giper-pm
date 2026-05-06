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
import { makeUser, makeProject, addMember, sessionUser } from './helpers/factories';

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

  it('MEMBER → INSUFFICIENT_PERMISSIONS', async () => {
    const m = await makeUser({ role: 'MEMBER' });
    await expectDomain(
      createProject({ ...baseInput, key: 'CC', name: 'C' }, sessionUser(m)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('VIEWER → INSUFFICIENT_PERMISSIONS', async () => {
    const v = await makeUser({ role: 'VIEWER' });
    await expectDomain(
      createProject({ ...baseInput, key: 'DD', name: 'D' }, sessionUser(v)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('duplicate key → CONFLICT', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await createProject({ ...baseInput, key: 'EE', name: 'E1' }, sessionUser(admin));
    await expectDomain(
      createProject({ ...baseInput, key: 'EE', name: 'E2' }, sessionUser(admin)),
      'CONFLICT',
    );
  });

  it('error has status=403 for permission denied', async () => {
    const m = await makeUser({ role: 'MEMBER' });
    try {
      await createProject({ ...baseInput, key: 'XX', name: 'X' }, sessionUser(m));
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).status).toBe(403);
    }
  });

  it('error has status=409 for duplicate key', async () => {
    const a = await makeUser({ role: 'ADMIN' });
    await createProject({ ...baseInput, key: 'YY', name: 'Y1' }, sessionUser(a));
    try {
      await createProject({ ...baseInput, key: 'YY', name: 'Y2' }, sessionUser(a));
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
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
  it('owner can archive', async () => {
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
    const archived = await archiveProject(p.id, sessionUser(admin));
    expect(archived.status).toBe('ARCHIVED');
  });

  it('LEAD member can archive', async () => {
    const owner = await makeUser();
    const lead = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, lead.id, 'LEAD');
    const archived = await archiveProject(p.id, sessionUser(lead));
    expect(archived.status).toBe('ARCHIVED');
  });

  it('CONTRIBUTOR cannot archive', async () => {
    const owner = await makeUser();
    const c = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, c.id, 'CONTRIBUTOR');
    await expectDomain(archiveProject(p.id, sessionUser(c)), 'INSUFFICIENT_PERMISSIONS');
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

  it('ADMIN scope=mine sees only owned/member', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    await makeProject({ ownerId: admin.id, key: 'AC' });
    await makeProject({ ownerId: stranger.id, key: 'AD' });
    const list = await listProjectsForUser(sessionUser(admin), { scope: 'mine' });
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('AC');
  });

  it('MEMBER scope=all is ignored — only owned/member visible', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const stranger = await makeUser({ role: 'MEMBER' });
    await makeProject({ ownerId: stranger.id, key: 'AE' });
    const mine = await makeProject({ ownerId: owner.id, key: 'AF' });
    const list = await listProjectsForUser(sessionUser(owner), { scope: 'all' });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(mine.id);
  });

  it('MEMBER sees projects where they’re a member', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const list = await listProjectsForUser(sessionUser(member));
    expect(list).toHaveLength(1);
  });

  it('includeArchived=false (default) hides ARCHIVED', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const live = await makeProject({ ownerId: owner.id, key: 'AG' });
    const dead = await makeProject({ ownerId: owner.id, key: 'AH' });
    await prisma.project.update({
      where: { id: dead.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const list = await listProjectsForUser(sessionUser(owner));
    expect(list.map((x) => x.id)).toEqual([live.id]);
  });

  it('status filter applies and overrides default ARCHIVED hiding', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    await makeProject({ ownerId: owner.id, key: 'AI' });
    const dead = await makeProject({ ownerId: owner.id, key: 'AJ' });
    await prisma.project.update({
      where: { id: dead.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const list = await listProjectsForUser(sessionUser(owner), { status: 'ARCHIVED' });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(dead.id);
  });

  it('VIEWER who is member sees the project', async () => {
    const owner = await makeUser();
    const v = await makeUser({ role: 'VIEWER' });
    const p = await makeProject({ ownerId: owner.id });
    await addMember(p.id, v.id, 'OBSERVER');
    const list = await listProjectsForUser(sessionUser(v));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(p.id);
  });
});

describe('getProject', () => {
  it('member can view by key', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'GP' });
    await addMember(p.id, m.id, 'CONTRIBUTOR');
    const got = await getProject(p.key, sessionUser(m));
    expect(got.id).toBe(p.id);
  });

  it('owner can view', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'GQ' });
    const got = await getProject(p.key, sessionUser(owner));
    expect(got.id).toBe(p.id);
  });

  it('non-member MEMBER → INSUFFICIENT_PERMISSIONS', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'GR' });
    await expectDomain(getProject(p.key, sessionUser(stranger)), 'INSUFFICIENT_PERMISSIONS');
  });

  it('PM (any) can view', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const p = await makeProject({ ownerId: owner.id, key: 'GS' });
    const got = await getProject(p.key, sessionUser(pm));
    expect(got.id).toBe(p.id);
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
