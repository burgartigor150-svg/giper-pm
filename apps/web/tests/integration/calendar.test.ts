import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { getDeadlinesInRange } from '@/lib/calendar/getDeadlines';
import { addMember, makeProject, makeTask, makeUser, sessionUser } from './helpers/factories';

/**
 * Calendar deadline visibility. The calendar is a PM tool: default
 * scope='mine' shows only tasks I'm personally on; scope='team'
 * (privileged-only) widens it to my team but never to the whole org.
 *
 * Implementation:
 *   apps/web/lib/calendar/getDeadlines.ts
 *
 * Rules under test:
 *   - 'mine' default: PER_STAKE ∩ team-gate
 *   - 'team' (ADMIN/PM): drops PER_STAKE, keeps team-gate
 *   - non-privileged caller cannot use 'team' (silently falls back)
 *   - filters: projectKey, assigneeId, status
 *   - team-gate includes me, my PmTeamMember rows, my PM's team
 *   - tasks without dueDate are excluded
 */

const fromTo = () => ({
  from: new Date('2026-05-01T00:00:00Z'),
  to: new Date('2026-05-31T00:00:00Z'),
});

async function makeTaskWithDue(
  args: Parameters<typeof makeTask>[0] & { dueDate?: Date | null },
) {
  const t = await makeTask(args);
  await prisma.task.update({
    where: { id: t.id },
    data: { dueDate: args.dueDate ?? new Date('2026-05-15T12:00:00Z') },
  });
  return t;
}

describe('getDeadlinesInRange — scope=mine (default for all roles)', () => {
  it('returns only tasks where I am on the hook (creator/assignee/reviewer/co/watcher)', async () => {
    const me = await makeUser({ role: 'MEMBER' });
    const other = await makeUser();
    const project = await makeProject({ ownerId: me.id });
    // Tasks I'm on:
    await makeTaskWithDue({ projectId: project.id, creatorId: me.id, assigneeId: me.id });
    await makeTaskWithDue({ projectId: project.id, creatorId: other.id, assigneeId: me.id });
    // Same project, different assignee — should NOT show.
    await makeTaskWithDue({ projectId: project.id, creatorId: other.id, assigneeId: other.id });
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me));
    expect(rows.map((r) => r.assignee?.id).sort()).toEqual([me.id, me.id].sort());
  });

  it('excludes tasks without a dueDate', async () => {
    const me = await makeUser();
    const project = await makeProject({ ownerId: me.id });
    await makeTask({ projectId: project.id, creatorId: me.id, assigneeId: me.id });
    // No dueDate set.
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me));
    expect(rows).toHaveLength(0);
  });

  it('excludes tasks whose dueDate is outside [from, to)', async () => {
    const me = await makeUser();
    const project = await makeProject({ ownerId: me.id });
    await makeTaskWithDue({
      projectId: project.id, creatorId: me.id, assigneeId: me.id,
      dueDate: new Date('2026-04-30T23:00:00Z'), // before
    });
    await makeTaskWithDue({
      projectId: project.id, creatorId: me.id, assigneeId: me.id,
      dueDate: new Date('2026-05-31T00:00:00Z'), // exactly = to → excluded (lt)
    });
    await makeTaskWithDue({
      projectId: project.id, creatorId: me.id, assigneeId: me.id,
      dueDate: new Date('2026-05-15T12:00:00Z'), // inside
    });
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me));
    expect(rows).toHaveLength(1);
  });

  it('team-gate: a PM does NOT see tasks of unrelated departments where they happen to be the creator', async () => {
    // PM creates a task and assigns it to a stranger who is NOT in
    // their PmTeam — the PM should not see it in the calendar.
    const pm = await makeUser({ role: 'PM' });
    const stranger = await makeUser();
    const project = await makeProject({ ownerId: pm.id });
    await makeTaskWithDue({
      projectId: project.id,
      creatorId: pm.id,
      assigneeId: stranger.id,
    });
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(pm));
    expect(rows).toHaveLength(0);
  });

  it('team-gate: keeps unassigned tasks created by me visible', async () => {
    const me = await makeUser();
    const project = await makeProject({ ownerId: me.id });
    await makeTaskWithDue({
      projectId: project.id,
      creatorId: me.id,
      assigneeId: null,
    });
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me));
    expect(rows).toHaveLength(1);
  });
});

describe('getDeadlinesInRange — scope=team', () => {
  it('PM sees tasks assigned to their PmTeam members (even if PM isn’t personally on them)', async () => {
    const pm = await makeUser({ role: 'PM' });
    const member = await makeUser();
    await prisma.pmTeamMember.create({
      data: { pmId: pm.id, memberId: member.id },
    });
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTaskWithDue({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: member.id,
    });
    const { from, to } = fromTo();
    const teamView = await getDeadlinesInRange(from, to, sessionUser(pm), {
      scope: 'team',
    });
    expect(teamView).toHaveLength(1);
    expect(teamView[0]!.assignee?.id).toBe(member.id);
    // Same call with default 'mine' returns nothing — PM is not on the
    // task and member is on their team but PER_STAKE wins.
    const myView = await getDeadlinesInRange(from, to, sessionUser(pm));
    expect(myView).toHaveLength(0);
  });

  it('MEMBER role cannot escalate to team — request silently falls back to mine', async () => {
    const me = await makeUser({ role: 'MEMBER' });
    const someoneElsePm = await makeUser({ role: 'PM' });
    const stranger = await makeUser();
    // stranger reports to a PM unrelated to `me`; we expect zero overlap.
    await prisma.pmTeamMember.create({
      data: { pmId: someoneElsePm.id, memberId: stranger.id },
    });
    const project = await makeProject({ ownerId: stranger.id });
    await makeTaskWithDue({
      projectId: project.id,
      creatorId: stranger.id,
      assigneeId: stranger.id,
    });
    const { from, to } = fromTo();
    const out = await getDeadlinesInRange(from, to, sessionUser(me), {
      scope: 'team',
    });
    expect(out).toHaveLength(0);
  });
});

describe('getDeadlinesInRange — filters', () => {
  async function scaffold() {
    const me = await makeUser({ role: 'ADMIN' });
    const proj1 = await makeProject({ ownerId: me.id, key: 'CA' });
    const proj2 = await makeProject({ ownerId: me.id, key: 'CB' });
    const teammate = await makeUser();
    await prisma.pmTeamMember.create({
      data: { pmId: me.id, memberId: teammate.id },
    });
    // Use status that exists in internalStatus enum: TODO/DONE.
    const t1 = await makeTaskWithDue({
      projectId: proj1.id, creatorId: me.id, assigneeId: me.id, status: 'TODO',
    });
    const t2 = await makeTaskWithDue({
      projectId: proj2.id, creatorId: me.id, assigneeId: teammate.id, status: 'DONE',
    });
    // Mirror status into internalStatus so the status filter applies.
    await prisma.task.update({ where: { id: t1.id }, data: { internalStatus: 'TODO' } });
    await prisma.task.update({ where: { id: t2.id }, data: { internalStatus: 'DONE' } });
    return { me, teammate, proj1, proj2 };
  }

  it('projectKey filter is case-insensitive (uppercased internally)', async () => {
    const { me, proj1 } = await scaffold();
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me), {
      scope: 'team',
      projectKey: proj1.key.toLowerCase(),
    });
    expect(rows.every((r) => r.projectKey === proj1.key)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('assigneeId narrows to one person', async () => {
    const { me, teammate } = await scaffold();
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me), {
      scope: 'team',
      assigneeId: teammate.id,
    });
    expect(rows.map((r) => r.assignee?.id)).toEqual([teammate.id]);
  });

  it('status filter accepts an array (whitelist)', async () => {
    const { me } = await scaffold();
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me), {
      scope: 'team',
      status: ['DONE'],
    });
    expect(rows.every((r) => r.internalStatus === 'DONE')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('resolveTeammateIds — peers of my PM', () => {
  it('a member sees peers in their PM’s team', async () => {
    const pm = await makeUser({ role: 'PM' });
    const me = await makeUser();
    const peer = await makeUser();
    await prisma.pmTeamMember.createMany({
      data: [
        { pmId: pm.id, memberId: me.id },
        { pmId: pm.id, memberId: peer.id },
      ],
    });
    const project = await makeProject({ ownerId: pm.id });
    // I'm watcher of a task assigned to my peer — gate must let it in.
    const t = await makeTaskWithDue({
      projectId: project.id,
      creatorId: pm.id,
      assigneeId: peer.id,
    });
    await prisma.taskWatcher.create({
      data: { taskId: t.id, userId: me.id },
    });
    const { from, to } = fromTo();
    const rows = await getDeadlinesInRange(from, to, sessionUser(me));
    // 'mine' scope: PER_STAKE (watcher) + team-gate (peer is on my PM's
    // team). Both pass.
    expect(rows).toHaveLength(1);
    // make sure addMember import is exercised somewhere so the linter
    // doesn't yell when this file is read in isolation.
    void addMember;
  });
});
