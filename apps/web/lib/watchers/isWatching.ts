import { prisma } from '@giper/db';

/**
 * True if the user has an explicit TaskWatcher row for this task.
 * Note: assignee and creator are always-watchers by definition, but
 * they don't appear here — this is just for "did the user click the
 * 👁 button?" The fan-out logic (createNotifications) folds in
 * assignee/creator separately.
 */
export async function isWatchingTask(taskId: string, userId: string): Promise<boolean> {
  const row = await prisma.taskWatcher.findUnique({
    where: { taskId_userId: { taskId, userId } },
    select: { id: true },
  });
  return !!row;
}
