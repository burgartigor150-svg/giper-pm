import { prisma } from '@giper/db';

export type SprintStatusValue = 'PLANNED' | 'ACTIVE' | 'CLOSED';

export type SprintView = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatusValue;
  taskCount: number;
};

/**
 * Sprints for a project (ACTIVE first, then PLANNED, then CLOSED; by start
 * date within a status). Fault-tolerant: returns [] if the table isn't there
 * yet (image live a beat before migrate deploy).
 */
export async function getSprints(projectId: string): Promise<SprintView[]> {
  try {
    const rows = await prisma.sprint.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        status: true,
        _count: { select: { tasks: true } },
      },
    });
    // status enum order is PLANNED, ACTIVE, CLOSED — re-sort so ACTIVE leads.
    const rank: Record<SprintStatusValue, number> = { ACTIVE: 0, PLANNED: 1, CLOSED: 2 };
    return rows
      .map((s) => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
        endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
        status: s.status,
        taskCount: s._count.tasks,
      }))
      .sort((a, b) => rank[a.status] - rank[b.status]);
  } catch (e) {
    console.warn('getSprints: unavailable', e);
    return [];
  }
}
