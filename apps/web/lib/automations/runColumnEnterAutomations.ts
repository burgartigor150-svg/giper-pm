import { prisma } from '@giper/db';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/**
 * Run a project's enabled CARD_ENTERS_COLUMN automation rules for a task that
 * just moved into `status`.
 *
 * Best-effort by contract: this never throws and never returns an error — a
 * misconfigured or failing rule must never affect the status change that
 * triggered it. Call it AFTER the status update is committed.
 *
 * Supported actions: SET_ASSIGNEE, SET_PRIORITY, SET_SWIMLANE. (ADD_COMMENT is
 * defined in the enum for future use but intentionally not executed here — it
 * needs an author identity the automation doesn't have.)
 */
export async function runColumnEnterAutomations(
  taskId: string,
  status: string,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return;

    const rules = await prisma.automationRule.findMany({
      where: {
        projectId: task.projectId,
        enabled: true,
        trigger: 'CARD_ENTERS_COLUMN',
      },
      orderBy: { order: 'asc' },
    });

    for (const rule of rules) {
      try {
        const trig = (rule.triggerConfig ?? {}) as { status?: string };
        if (trig.status !== status) continue;
        const cfg = (rule.actionConfig ?? {}) as Record<string, unknown>;

        if (rule.actionType === 'SET_ASSIGNEE' && typeof cfg.userId === 'string') {
          await prisma.task.update({
            where: { id: taskId },
            data: { assigneeId: cfg.userId },
          });
        } else if (
          rule.actionType === 'SET_PRIORITY' &&
          typeof cfg.priority === 'string' &&
          PRIORITIES.includes(cfg.priority)
        ) {
          await prisma.task.update({
            where: { id: taskId },
            data: { priority: cfg.priority as never },
          });
        } else if (rule.actionType === 'SET_SWIMLANE') {
          const swimlaneId =
            typeof cfg.swimlaneId === 'string' && cfg.swimlaneId ? cfg.swimlaneId : null;
          if (swimlaneId) {
            const lane = await prisma.boardSwimlane.findUnique({
              where: { id: swimlaneId },
              select: { projectId: true },
            });
            if (!lane || lane.projectId !== task.projectId) continue;
          }
          await prisma.task.update({
            where: { id: taskId },
            data: { swimlaneId },
          });
        }
      } catch (e) {
        console.warn('automation rule failed', rule.id, e);
      }
    }
  } catch (e) {
    console.warn('runColumnEnterAutomations failed', e);
  }
}
