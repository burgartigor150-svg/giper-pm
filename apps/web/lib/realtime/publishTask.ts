import { prisma } from '@giper/db';
import { channelForProject, channelForTask } from '@giper/realtime';
import { publishRealtime } from '@giper/realtime/server';

/**
 * Publish a task-scoped event to both the task channel (for the task
 * detail page) and the parent project channel (for the kanban board).
 * Server actions can fire-and-forget — failures are swallowed by the
 * underlying publishRealtime, which never throws.
 *
 * One Prisma read per call to fetch the projectId. We don't cache it
 * — these calls are rare (one per status-change / assign / comment),
 * and a stale cache would be a worse failure mode than an extra hit.
 */
export async function publishTaskEvent(
  taskId: string,
  payload: unknown,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return;
  await Promise.all([
    publishRealtime({ channel: channelForTask(taskId), payload }),
    publishRealtime({ channel: channelForProject(task.projectId), payload }),
  ]);
}
