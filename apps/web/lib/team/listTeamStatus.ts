import { prisma } from '@giper/db';

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export type TeamStatusKind = 'ACTIVE' | 'ONLINE' | 'OFFLINE' | 'NO_DEVICE';

export type TeamRow = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string;
  };
  currentTask: {
    id: string;
    number: number;
    title: string;
    project: { key: string };
  } | null;
  /** When the running timer started, if any. */
  timerStartedAt: Date | null;
  /** Total minutes logged today (closed + live for active timer). */
  todayMin: number;
  /** Last AgentDevice heartbeat across all the user's devices. */
  lastSeenAt: Date | null;
  status: TeamStatusKind;
};

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * One-row-per-active-user snapshot for the /team page. PM/ADMIN only.
 * - ACTIVE: live timer running right now
 * - ONLINE: agent heartbeat within last 2 min, no live timer
 * - OFFLINE: had a heartbeat at some point but not in the last 2 min
 * - NO_DEVICE: never paired any agent (no AgentDevice rows)
 */
export async function listTeamStatus(): Promise<TeamRow[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      agentDevices: {
        select: { lastSeenAt: true, isActive: true },
      },
    },
  });

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const todayFrom = startOfTodayUTC();
  const todayTo = new Date(todayFrom.getTime() + 24 * 3600_000);

  // Pull running timers + today entries in two scoped queries.
  const [activeTimers, todayEntries] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        userId: { in: userIds },
        endedAt: null,
        source: 'MANUAL_TIMER',
      },
      select: {
        userId: true,
        startedAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            project: { select: { key: true } },
          },
        },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: { in: userIds },
        startedAt: { gte: todayFrom, lt: todayTo },
      },
      select: {
        userId: true,
        startedAt: true,
        endedAt: true,
        durationMin: true,
      },
    }),
  ]);

  const activeByUser = new Map(activeTimers.map((t) => [t.userId, t]));
  const now = Date.now();

  // Today minutes per user (closed + live for active).
  const minutesByUser = new Map<string, number>();
  for (const e of todayEntries) {
    const mins =
      e.endedAt && e.durationMin
        ? e.durationMin
        : Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60_000));
    minutesByUser.set(e.userId, (minutesByUser.get(e.userId) ?? 0) + mins);
  }

  return users.map((u) => {
    const active = activeByUser.get(u.id);
    const lastSeenAt = u.agentDevices
      .map((d) => d.lastSeenAt?.getTime() ?? 0)
      .reduce((max, t) => (t > max ? t : max), 0);
    const lastSeenDate = lastSeenAt > 0 ? new Date(lastSeenAt) : null;

    let status: TeamStatusKind;
    if (active) {
      status = 'ACTIVE';
    } else if (u.agentDevices.length === 0) {
      status = 'NO_DEVICE';
    } else if (lastSeenAt > 0 && now - lastSeenAt < ONLINE_THRESHOLD_MS) {
      status = 'ONLINE';
    } else {
      status = 'OFFLINE';
    }

    return {
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        role: u.role,
      },
      currentTask: active?.task ?? null,
      timerStartedAt: active?.startedAt ?? null,
      todayMin: minutesByUser.get(u.id) ?? 0,
      lastSeenAt: lastSeenDate,
      status,
    };
  });
}
