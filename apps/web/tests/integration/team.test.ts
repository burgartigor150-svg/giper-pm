import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { listTeamStatus } from '@/lib/team/listTeamStatus';
import { makeUser, makeProject, makeTask } from './helpers/factories';

// Helpers ----------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60_000);
}

async function makeAgentDevice(opts: {
  userId: string;
  lastSeenAt: Date | null;
  isActive?: boolean;
  authToken?: string;
  name?: string;
}) {
  return prisma.agentDevice.create({
    data: {
      userId: opts.userId,
      kind: 'DESKTOP_AGENT',
      name: opts.name ?? 'Test Device',
      authToken: opts.authToken ?? `tok-${opts.userId}-${Date.now()}-${Math.random()}`,
      lastSeenAt: opts.lastSeenAt,
      isActive: opts.isActive ?? true,
    },
  });
}

async function createClosedEntry(opts: {
  userId: string;
  taskId: string | null;
  startedAt: Date;
  durationMin: number;
  source?: 'MANUAL_TIMER' | 'MANUAL_FORM' | 'AUTO_AGENT';
}) {
  const endedAt = new Date(opts.startedAt.getTime() + opts.durationMin * 60_000);
  return prisma.timeEntry.create({
    data: {
      userId: opts.userId,
      taskId: opts.taskId,
      startedAt: opts.startedAt,
      endedAt,
      durationMin: opts.durationMin,
      source: opts.source ?? 'MANUAL_TIMER',
    },
  });
}

async function createActiveTimer(opts: {
  userId: string;
  taskId: string | null;
  startedAt: Date;
  source?: 'MANUAL_TIMER' | 'AUTO_AGENT';
}) {
  return prisma.timeEntry.create({
    data: {
      userId: opts.userId,
      taskId: opts.taskId,
      startedAt: opts.startedAt,
      endedAt: null,
      durationMin: null,
      source: opts.source ?? 'MANUAL_TIMER',
    },
  });
}

// =======================================================================
// listTeamStatus
// =======================================================================

describe('listTeamStatus', () => {
  it('returns [] when DB has no users', async () => {
    const result = await listTeamStatus();
    expect(result).toEqual([]);
  });

  it('does not include inactive users', async () => {
    await makeUser({ isActive: false, name: 'Inactive Ivan' });
    const result = await listTeamStatus();
    expect(result).toEqual([]);
  });

  it('includes only active users', async () => {
    await makeUser({ isActive: false, name: 'Inactive User' });
    const active = await makeUser({ isActive: true, name: 'Active User' });
    const result = await listTeamStatus();
    expect(result.map((r) => r.user.id)).toEqual([active.id]);
  });

  it('active user with no devices, no timer, no entries → NO_DEVICE / nulls / 0', async () => {
    const u = await makeUser({ name: 'Lone Wolf' });
    const result = await listTeamStatus();
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.status).toBe('NO_DEVICE');
    expect(row.currentTask).toBeNull();
    expect(row.todayMin).toBe(0);
    expect(row.lastSeenAt).toBeNull();
    expect(row.timerStartedAt).toBeNull();
    expect(row.user.id).toBe(u.id);
  });

  it('active user with running MANUAL_TIMER → ACTIVE, currentTask populated, timerStartedAt set', async () => {
    const u = await makeUser({ name: 'Timer User' });
    const proj = await makeProject({ ownerId: u.id, key: 'TMR', name: 'TimerProj' });
    const task = await makeTask({
      projectId: proj.id,
      creatorId: u.id,
      assigneeId: u.id,
      title: 'Doing thing',
    });
    const startedAt = minutesAgo(5);
    await createActiveTimer({ userId: u.id, taskId: task.id, startedAt });

    const result = await listTeamStatus();
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.status).toBe('ACTIVE');
    expect(row.currentTask?.id).toBe(task.id);
    expect(row.currentTask?.title).toBe('Doing thing');
    expect(row.currentTask?.project.key).toBe('TMR');
    expect(row.timerStartedAt?.getTime()).toBe(startedAt.getTime());
  });

  it('active timer without taskId still yields ACTIVE with currentTask=null', async () => {
    const u = await makeUser({ name: 'Free Timer' });
    await createActiveTimer({ userId: u.id, taskId: null, startedAt: minutesAgo(2) });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('ACTIVE');
    expect(result[0].currentTask).toBeNull();
    expect(result[0].timerStartedAt).not.toBeNull();
  });

  it('active timer with non-MANUAL_TIMER source is ignored', async () => {
    const u = await makeUser({ name: 'Auto User' });
    const proj = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: proj.id, creatorId: u.id, assigneeId: u.id });
    await createActiveTimer({
      userId: u.id,
      taskId: task.id,
      startedAt: minutesAgo(5),
      source: 'AUTO_AGENT',
    });
    // Pair a device too so we have a baseline
    await makeAgentDevice({ userId: u.id, lastSeenAt: minutesAgo(15) });

    const result = await listTeamStatus();
    // Without a recent (<2 min) heartbeat and without a manual timer → OFFLINE
    expect(result[0].status).toBe('OFFLINE');
    expect(result[0].timerStartedAt).toBeNull();
    expect(result[0].currentTask).toBeNull();
  });

  it('AgentDevice.lastSeenAt = now → ONLINE', async () => {
    const u = await makeUser({ name: 'Online User' });
    await makeAgentDevice({ userId: u.id, lastSeenAt: new Date() });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('ONLINE');
    expect(result[0].lastSeenAt).not.toBeNull();
  });

  it('AgentDevice.lastSeenAt = 10 minutes ago → OFFLINE', async () => {
    const u = await makeUser({ name: 'Stale User' });
    await makeAgentDevice({ userId: u.id, lastSeenAt: minutesAgo(10) });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('OFFLINE');
    expect(result[0].lastSeenAt).not.toBeNull();
  });

  it('lastSeenAt is the MAX across multiple devices', async () => {
    const u = await makeUser({ name: 'Multi Device' });
    const old = minutesAgo(60);
    const recent = minutesAgo(1); // within the 2-min ONLINE window
    await makeAgentDevice({ userId: u.id, lastSeenAt: old, name: 'Old' });
    await makeAgentDevice({ userId: u.id, lastSeenAt: recent, name: 'Recent' });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('ONLINE');
    expect(result[0].lastSeenAt?.getTime()).toBe(recent.getTime());
  });

  it('device with null lastSeenAt is treated as never-seen (still OFFLINE)', async () => {
    const u = await makeUser({ name: 'Paired Never Seen' });
    await makeAgentDevice({ userId: u.id, lastSeenAt: null });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('OFFLINE');
    expect(result[0].lastSeenAt).toBeNull();
  });

  it('ACTIVE wins over ONLINE when user has both timer and recent heartbeat', async () => {
    const u = await makeUser({ name: 'Busy Bee' });
    const proj = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: proj.id, creatorId: u.id, assigneeId: u.id });
    await makeAgentDevice({ userId: u.id, lastSeenAt: new Date() });
    await createActiveTimer({ userId: u.id, taskId: task.id, startedAt: minutesAgo(3) });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('ACTIVE');
  });

  it('todayMin sums today entries: 30 closed + 60 closed + active running ~5 min ≈ 95', async () => {
    const u = await makeUser({ name: 'Counting User' });
    const proj = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: proj.id, creatorId: u.id, assigneeId: u.id });
    const start1 = startOfToday();
    start1.setHours(9, 0, 0, 0);
    const start2 = startOfToday();
    start2.setHours(10, 0, 0, 0);
    await createClosedEntry({ userId: u.id, taskId: task.id, startedAt: start1, durationMin: 30 });
    await createClosedEntry({ userId: u.id, taskId: task.id, startedAt: start2, durationMin: 60 });
    await createActiveTimer({ userId: u.id, taskId: task.id, startedAt: minutesAgo(5) });

    const result = await listTeamStatus();
    expect(result[0].todayMin).toBeGreaterThanOrEqual(94);
    expect(result[0].todayMin).toBeLessThanOrEqual(96);
    expect(result[0].status).toBe('ACTIVE');
  });

  it('todayMin does not include yesterday\'s entries', async () => {
    const u = await makeUser({ name: 'Y User' });
    const proj = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: proj.id, creatorId: u.id, assigneeId: u.id });
    const yesterday = startOfToday();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(10, 0, 0, 0);
    await createClosedEntry({ userId: u.id, taskId: task.id, startedAt: yesterday, durationMin: 120 });
    const result = await listTeamStatus();
    expect(result[0].todayMin).toBe(0);
  });

  it('todayMin only counts each user\'s own entries', async () => {
    const me = await makeUser({ name: 'Aaa Mine' });
    const other = await makeUser({ name: 'Bbb Other' });
    const proj = await makeProject({ ownerId: me.id });
    const task = await makeTask({ projectId: proj.id, creatorId: me.id, assigneeId: me.id });
    const noon = startOfToday();
    noon.setHours(12, 0, 0, 0);
    await createClosedEntry({ userId: me.id, taskId: task.id, startedAt: noon, durationMin: 20 });
    await createClosedEntry({ userId: other.id, taskId: task.id, startedAt: noon, durationMin: 40 });

    const result = await listTeamStatus();
    expect(result).toHaveLength(2);
    const meRow = result.find((r) => r.user.id === me.id)!;
    const otherRow = result.find((r) => r.user.id === other.id)!;
    expect(meRow.todayMin).toBe(20);
    expect(otherRow.todayMin).toBe(40);
  });

  it('sorts result alphabetically by user.name asc', async () => {
    await makeUser({ name: 'Charlie' });
    await makeUser({ name: 'Alice' });
    await makeUser({ name: 'Bob' });
    const result = await listTeamStatus();
    expect(result.map((r) => r.user.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('user with closed entries today but no devices → NO_DEVICE, todayMin populated', async () => {
    const u = await makeUser({ name: 'Logged User' });
    const proj = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: proj.id, creatorId: u.id, assigneeId: u.id });
    const noon = startOfToday();
    noon.setHours(13, 0, 0, 0);
    await createClosedEntry({ userId: u.id, taskId: task.id, startedAt: noon, durationMin: 15 });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('NO_DEVICE');
    expect(result[0].todayMin).toBe(15);
  });

  it('device with lastSeenAt at exactly 2 min ago → OFFLINE (just outside window)', async () => {
    const u = await makeUser({ name: 'Edge User' });
    // Slightly outside the 2-min window to avoid race with `now`
    await makeAgentDevice({ userId: u.id, lastSeenAt: new Date(Date.now() - 2 * 60 * 1000 - 500) });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('OFFLINE');
  });

  it('device with lastSeenAt 30 seconds ago → ONLINE (well within window)', async () => {
    const u = await makeUser({ name: 'Fresh User' });
    await makeAgentDevice({ userId: u.id, lastSeenAt: new Date(Date.now() - 30 * 1000) });
    const result = await listTeamStatus();
    expect(result[0].status).toBe('ONLINE');
  });

  it('returned user fields contain id, name, email, image, role', async () => {
    const u = await makeUser({ name: 'Full Fields', role: 'PM' });
    const result = await listTeamStatus();
    const row = result[0];
    expect(row.user.id).toBe(u.id);
    expect(row.user.name).toBe('Full Fields');
    expect(row.user.email).toBe(u.email);
    expect(row.user.role).toBe('PM');
    expect(row.user).toHaveProperty('image');
  });

  it('multiple users with mixed statuses are reported correctly', async () => {
    const a = await makeUser({ name: 'A_active' });
    const b = await makeUser({ name: 'B_online' });
    const c = await makeUser({ name: 'C_offline' });
    const d = await makeUser({ name: 'D_nodev' });

    // A: ACTIVE
    const projA = await makeProject({ ownerId: a.id });
    const taskA = await makeTask({ projectId: projA.id, creatorId: a.id, assigneeId: a.id });
    await makeAgentDevice({ userId: a.id, lastSeenAt: new Date() });
    await createActiveTimer({ userId: a.id, taskId: taskA.id, startedAt: minutesAgo(2) });
    // B: ONLINE
    await makeAgentDevice({ userId: b.id, lastSeenAt: new Date() });
    // C: OFFLINE
    await makeAgentDevice({ userId: c.id, lastSeenAt: minutesAgo(30) });
    // D: NO_DEVICE — nothing

    const result = await listTeamStatus();
    expect(result.map((r) => r.user.name)).toEqual([
      'A_active',
      'B_online',
      'C_offline',
      'D_nodev',
    ]);
    expect(result.find((r) => r.user.id === a.id)!.status).toBe('ACTIVE');
    expect(result.find((r) => r.user.id === b.id)!.status).toBe('ONLINE');
    expect(result.find((r) => r.user.id === c.id)!.status).toBe('OFFLINE');
    expect(result.find((r) => r.user.id === d.id)!.status).toBe('NO_DEVICE');
  });
});
