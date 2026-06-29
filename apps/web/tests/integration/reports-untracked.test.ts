import { describe, it, expect } from 'vitest';

/**
 * Regression for the audit finding: reports' fetchEntries used a `task: {...}`
 * relation filter that silently dropped every no-task ("Без задачи") time entry,
 * so untrackedHours was always 0 and team totals were undercounted. The team
 * scope must now count no-task entries; a project-scoped report still excludes
 * them (a no-task entry has no project).
 */

import { prisma } from '@giper/db';
import { getTimeByTask } from '@/lib/reports/queries';
import type { ReportsRange } from '@/lib/reports/filters';
import type { ScopedQuery } from '@/lib/reports/scope';
import { makeUser, makeProject, makeTask } from './helpers/factories';

const range: ReportsRange = {
  from: new Date('2025-03-01T00:00:00Z'),
  to: new Date('2025-03-02T00:00:00Z'),
  granularity: 'day',
};
const start = new Date('2025-03-01T09:00:00Z');

describe('reports — no-task time entries', () => {
  it('team scope counts untracked time; project scope excludes it', async () => {
    const user = await makeUser();
    const project = await makeProject({ ownerId: user.id, key: 'RPTU' });
    const task = await makeTask({ projectId: project.id, creatorId: user.id });

    await prisma.timeEntry.create({
      data: {
        userId: user.id,
        taskId: task.id,
        startedAt: start,
        endedAt: new Date('2025-03-01T10:00:00Z'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });
    // No-task entry: 30 minutes of "Без задачи" work, not tied to any project.
    await prisma.timeEntry.create({
      data: {
        userId: user.id,
        taskId: null,
        startedAt: start,
        endedAt: new Date('2025-03-01T09:30:00Z'),
        durationMin: 30,
        source: 'MANUAL_FORM',
      },
    });

    const teamScope: ScopedQuery = {
      userId: null,
      projectId: null,
      visibleProjectIds: [project.id],
      visibleUserIds: new Set([user.id]),
    };
    const team = await getTimeByTask(teamScope, range);
    expect(team.untrackedHours).toBeCloseTo(0.5, 2); // the 30-min no-task entry is now counted

    const projectScope: ScopedQuery = {
      userId: null,
      projectId: project.id,
      visibleProjectIds: [project.id],
      visibleUserIds: new Set([user.id]),
    };
    const scoped = await getTimeByTask(projectScope, range);
    expect(scoped.untrackedHours).toBe(0); // excluded from a single-project report
  });
});
