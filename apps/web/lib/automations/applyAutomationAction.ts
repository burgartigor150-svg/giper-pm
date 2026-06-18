import { prisma } from '@giper/db';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/**
 * Apply a single automation action to a task. Shared by every trigger engine
 * (column-enter, task-created, …). Validates lightly; the per-rule caller wraps
 * this in try/catch so one bad rule can't break the batch or the triggering
 * change. Supported: SET_ASSIGNEE, SET_PRIORITY, SET_SWIMLANE.
 */
export async function applyAutomationAction(
  taskId: string,
  projectId: string,
  actionType: string,
  actionConfig: Record<string, unknown>,
): Promise<void> {
  if (actionType === 'SET_ASSIGNEE' && typeof actionConfig.userId === 'string') {
    await prisma.task.update({
      where: { id: taskId },
      data: { assigneeId: actionConfig.userId },
    });
  } else if (
    actionType === 'SET_PRIORITY' &&
    typeof actionConfig.priority === 'string' &&
    PRIORITIES.includes(actionConfig.priority)
  ) {
    await prisma.task.update({
      where: { id: taskId },
      data: { priority: actionConfig.priority as never },
    });
  } else if (actionType === 'SET_SWIMLANE') {
    const swimlaneId =
      typeof actionConfig.swimlaneId === 'string' && actionConfig.swimlaneId
        ? actionConfig.swimlaneId
        : null;
    if (swimlaneId) {
      const lane = await prisma.boardSwimlane.findUnique({
        where: { id: swimlaneId },
        select: { projectId: true },
      });
      if (!lane || lane.projectId !== projectId) return;
    }
    await prisma.task.update({
      where: { id: taskId },
      data: { swimlaneId },
    });
  }
}
