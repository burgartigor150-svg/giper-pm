import { prisma } from '@giper/db';

export type RecurringTaskView = {
  id: string;
  title: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'EPIC' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  intervalDays: number;
  /** YYYY-MM-DD derived from nextRunAt, for the date input. */
  startDate: string;
  active: boolean;
};

/**
 * Load a project's recurring cards for the settings form. Fault-tolerant:
 * returns [] if the table isn't there yet (image live a beat before migrate
 * deploy) so settings never 500 over recurring cards.
 */
export async function getRecurringTasks(projectId: string): Promise<RecurringTaskView[]> {
  try {
    const rows = await prisma.recurringTask.findMany({
      where: { projectId },
      orderBy: { nextRunAt: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        priority: true,
        intervalDays: true,
        nextRunAt: true,
        active: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      priority: r.priority,
      intervalDays: r.intervalDays,
      // toISOString slice gives the UTC date; close enough for the anchor input.
      startDate: r.nextRunAt.toISOString().slice(0, 10),
      active: r.active,
    }));
  } catch (e) {
    console.warn('getRecurringTasks: unavailable', e);
    return [];
  }
}
