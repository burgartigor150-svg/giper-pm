import { prisma } from '@giper/db';
import { applyAutomationAction } from './applyAutomationAction';

/**
 * Run a project's enabled TASK_CREATED automation rules for a just-created task.
 *
 * Best-effort by contract: never throws — must not break task creation. Call it
 * after the task row is committed.
 */
export async function runTaskCreatedAutomations(
  taskId: string,
  projectId: string,
): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { projectId, enabled: true, trigger: 'TASK_CREATED' },
      orderBy: { order: 'asc' },
    });
    for (const rule of rules) {
      try {
        await applyAutomationAction(
          taskId,
          projectId,
          rule.actionType,
          (rule.actionConfig ?? {}) as Record<string, unknown>,
        );
      } catch (e) {
        console.warn('automation rule failed', rule.id, e);
      }
    }
  } catch (e) {
    console.warn('runTaskCreatedAutomations failed', e);
  }
}
