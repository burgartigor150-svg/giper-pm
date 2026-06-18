import { prisma } from '@giper/db';
import { applyAutomationAction } from './applyAutomationAction';

/**
 * Run a project's enabled CARD_ENTERS_COLUMN automation rules for a task that
 * just moved into `status`.
 *
 * Best-effort by contract: never throws — a misconfigured or failing rule must
 * never affect the status change that triggered it. Call it AFTER the status
 * update is committed.
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
        await applyAutomationAction(
          taskId,
          task.projectId,
          rule.actionType,
          (rule.actionConfig ?? {}) as Record<string, unknown>,
        );
      } catch (e) {
        console.warn('automation rule failed', rule.id, e);
      }
    }
  } catch (e) {
    console.warn('runColumnEnterAutomations failed', e);
  }
}
