import { prisma, type TaskStatus } from '@giper/db';

/**
 * Whether moving a card from→to is allowed by the project's configurable
 * workflow (Jira workflow transition allowlist).
 *
 * INERT default: a project with NO WorkflowTransition rows allows EVERY move, so
 * behavior is byte-identical to today until a project opts in. A no-op move
 * (from===to) is always allowed; CANCELED is always reachable (escape hatch so a
 * card can never get stuck). Otherwise a matching allowlist row is required.
 */
export async function isTransitionAllowed(
  projectId: string,
  from: TaskStatus,
  to: TaskStatus,
): Promise<boolean> {
  if (from === to) return true;
  if (to === 'CANCELED') return true;
  const rules = await prisma.workflowTransition.findMany({
    where: { projectId },
    select: { fromStatus: true, toStatus: true },
  });
  if (rules.length === 0) return true; // no workflow configured → unrestricted
  return rules.some((r) => r.fromStatus === from && r.toStatus === to);
}

/** The project's transition allowlist (for the settings editor + display). */
export async function listWorkflowTransitions(
  projectId: string,
): Promise<{ fromStatus: TaskStatus; toStatus: TaskStatus }[]> {
  return prisma.workflowTransition.findMany({
    where: { projectId },
    select: { fromStatus: true, toStatus: true },
    orderBy: [{ fromStatus: 'asc' }, { toStatus: 'asc' }],
  });
}
