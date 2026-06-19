import { prisma } from '@giper/db';

export type ActiveSprint = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
};

/** The project's single ACTIVE sprint, or null. Fault-tolerant. */
export async function getActiveSprint(projectId: string): Promise<ActiveSprint | null> {
  try {
    const s = await prisma.sprint.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      select: { id: true, name: true, goal: true, startDate: true, endDate: true },
    });
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      goal: s.goal,
      startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
      endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
    };
  } catch (e) {
    console.warn('getActiveSprint: unavailable', e);
    return null;
  }
}
