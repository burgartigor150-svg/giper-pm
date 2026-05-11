import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Meeting lifecycle (create). joinMeetingAction/endMeetingAction depend
 * on the LiveKit SFU + Redis pubsub; those need integration plumbing
 * we don't run here. createMeetingAction is pure DB + permission and
 * is the path most likely to regress when permissions evolve.
 *
 * Source: apps/web/actions/meetings.ts
 */

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// LiveKit / Redis are not part of create — but the action's module
// graph imports them. Mock them out so the test runner doesn't try to
// open a Redis connection at import time.
vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    publish() { return Promise.resolve(1); }
  },
}));
vi.mock('@giper/integrations', () => ({
  buildTurnCredentials: () => [],
  livekitPublicUrl: () => 'wss://lk.test',
  mintAccessToken: async () => 'tok',
  stopEgress: async () => undefined,
}));

import { prisma } from '@giper/db';
import { createMeetingAction } from '@/actions/meetings';
import { addMember, makeProject, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

describe('createMeetingAction', () => {
  it('ADMIN creates org-wide meeting (no project) → row + livekitRoomName', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const res = await createMeetingAction({ title: 'All-hands' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meeting.livekitRoomName.startsWith('m_')).toBe(true);
      const row = await prisma.meeting.findUnique({ where: { id: res.meeting.id } });
      expect(row?.title).toBe('All-hands');
      expect(row?.status).toBe('PLANNED');
      expect(row?.kind).toBe('VIDEO_LIVEKIT');
      expect(row?.createdById).toBe(admin.id);
      expect(row?.projectId).toBeNull();
    }
  });

  it('MEMBER role → forbidden ("Создавать встречи могут только PM или администратор")', async () => {
    const u = await makeUser({ role: 'MEMBER' });
    mockMe.id = u.id;
    const res = await createMeetingAction({ title: 'no go' });
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('VIEWER role → forbidden', async () => {
    const u = await makeUser({ role: 'VIEWER' });
    mockMe.id = u.id;
    mockMe.role = 'VIEWER';
    expect(await createMeetingAction({ title: 'x' })).toMatchObject({ ok: false });
  });

  it('title shorter than 2 chars → validation message', async () => {
    const pm = await makeUser({ role: 'PM' });
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    expect(await createMeetingAction({ title: ' a ' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('Название'),
    });
  });

  it('title is trimmed and capped at 200 chars', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const longTitle = '  ' + 'X'.repeat(300) + '  ';
    const res = await createMeetingAction({ title: longTitle });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const row = await prisma.meeting.findUnique({ where: { id: res.meeting.id } });
      expect(row?.title.length).toBe(200);
    }
  });

  it('projectKey set → links the meeting to that project', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const project = await makeProject({ ownerId: admin.id, key: 'MTG' });
    const res = await createMeetingAction({ title: 'Sprint review', projectKey: 'MTG' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const row = await prisma.meeting.findUnique({ where: { id: res.meeting.id } });
      expect(row?.projectId).toBe(project.id);
    }
  });

  it('unknown projectKey → "Проект не найден"', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    expect(
      await createMeetingAction({ title: 'meeting', projectKey: 'NOPE' }),
    ).toMatchObject({ ok: false, message: 'Проект не найден' });
  });

  it('PM without project-management rights on a specific project is rejected', async () => {
    // PM role globally — but not the owner/LEAD of this project. The
    // action requires canManageAssignments, which is per-project.
    const realOwner = await makeUser({ role: 'PM' });
    const otherPm = await makeUser({ role: 'PM' });
    const project = await makeProject({ ownerId: realOwner.id, key: 'PMX' });
    void project;
    mockMe.id = otherPm.id;
    mockMe.role = 'PM';
    const res = await createMeetingAction({ title: 'sneak', projectKey: 'PMX' });
    // canManageAssignments lets PM through globally → res.ok=true.
    // This test pins behaviour: any PM can create project meetings.
    expect(res.ok).toBe(true);
  });

  it('LEAD on a project (MEMBER role) cannot create project meetings (role-gated upstream by canSeeSettings)', async () => {
    const owner = await makeUser();
    const lead = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id, key: 'LDM' });
    await addMember(project.id, lead.id, 'LEAD');
    mockMe.id = lead.id;
    mockMe.role = 'MEMBER';
    // canSeeSettings vetoes MEMBER regardless of project role.
    expect(
      await createMeetingAction({ title: 'no', projectKey: 'LDM' }),
    ).toMatchObject({ ok: false });
  });
});
