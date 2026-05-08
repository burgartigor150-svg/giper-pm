import { prisma } from '@giper/db';

export type ProjectBudgetReport = {
  /** Hours configured on the project, or null if no budget set. */
  budgetHours: number | null;
  /** Sum of estimateHours across non-cancelled tasks. */
  estimatedHours: number;
  /** Sum of TimeEntry minutes across all project tasks → hours. */
  spentHours: number;
  /** Hours logged in the trailing 14 days; basis for the velocity. */
  velocityHoursPerDay: number;
  /** Hours remaining on still-open tasks (estimate − already spent). */
  remainingEstimatedHours: number;
  /** Days projected to finish the remaining work at current velocity. */
  projectedDaysToFinish: number | null;
  /** ISO date when the projected work will be finished. */
  projectedFinishDate: string | null;
  /** Currency-agnostic cost: spentHours × hourlyRate (when both set). */
  spentMoney: number | null;
  budgetMoney: number | null;
  hourlyRate: number | null;
  /** True when spent already crosses the budget threshold. */
  overBudget: boolean;
};

const VELOCITY_WINDOW_DAYS = 14;

export async function getProjectBudgetReport(
  projectId: string,
): Promise<ProjectBudgetReport | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetHours: true, hourlyRate: true },
  });
  if (!project) return null;

  const taskAgg = await prisma.task.aggregate({
    where: {
      projectId,
      internalStatus: { not: 'CANCELED' },
    },
    _sum: { estimateHours: true },
  });
  const estimatedHours = Number(taskAgg._sum.estimateHours ?? 0);

  // Total spent — sum of TimeEntry durations for any task in the project.
  // Cast to double so the row carries a JS-native number (raw bigint
  // serialises poorly through RSC).
  const totalSpentRows = await prisma.$queryRaw<Array<{ minutes: number | null }>>`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60), 0)::float8 AS minutes
    FROM "TimeEntry" te
    JOIN "Task" t ON t.id = te."taskId"
    WHERE t."projectId" = ${projectId} AND te."endedAt" IS NOT NULL
  `;
  const spentMinutes = Number(totalSpentRows[0]?.minutes ?? 0);
  const spentHours = spentMinutes / 60;

  // Velocity: hours/day over the trailing window.
  const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 3600_000);
  const recentRows = await prisma.$queryRaw<Array<{ minutes: number | null }>>`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60), 0)::float8 AS minutes
    FROM "TimeEntry" te
    JOIN "Task" t ON t.id = te."taskId"
    WHERE t."projectId" = ${projectId}
      AND te."endedAt" IS NOT NULL
      AND te."startedAt" >= ${since}
  `;
  const recentMinutes = Number(recentRows[0]?.minutes ?? 0);
  const velocityHoursPerDay = recentMinutes / 60 / VELOCITY_WINDOW_DAYS;

  const remainingEstimatedHours = Math.max(0, estimatedHours - spentHours);
  const projectedDaysToFinish =
    velocityHoursPerDay > 0
      ? Math.ceil(remainingEstimatedHours / velocityHoursPerDay)
      : null;
  const projectedFinishDate = projectedDaysToFinish
    ? new Date(Date.now() + projectedDaysToFinish * 24 * 3600_000)
        .toISOString()
        .slice(0, 10)
    : null;

  const budgetHours = project.budgetHours ? Number(project.budgetHours) : null;
  const hourlyRate = project.hourlyRate ? Number(project.hourlyRate) : null;
  const spentMoney = hourlyRate != null ? +(spentHours * hourlyRate).toFixed(2) : null;
  const budgetMoney =
    hourlyRate != null && budgetHours != null
      ? +(budgetHours * hourlyRate).toFixed(2)
      : null;
  const overBudget = budgetHours != null && spentHours > budgetHours;

  return {
    budgetHours,
    estimatedHours: +estimatedHours.toFixed(2),
    spentHours: +spentHours.toFixed(2),
    velocityHoursPerDay: +velocityHoursPerDay.toFixed(2),
    remainingEstimatedHours: +remainingEstimatedHours.toFixed(2),
    projectedDaysToFinish,
    projectedFinishDate,
    spentMoney,
    budgetMoney,
    hourlyRate,
    overBudget,
  };
}
