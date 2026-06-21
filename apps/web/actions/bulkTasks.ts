'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { taskStatusSchema, taskPrioritySchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { changeTaskStatus } from '@/lib/tasks/changeTaskStatus';
import { assignTask } from '@/lib/tasks/assignTask';
import { updateTask } from '@/lib/tasks/updateTask';
import { DomainError } from '@/lib/errors';

/** Hard cap per batch — keeps one action from looping unbounded work. */
const MAX_BULK = 200;

const bulkOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: taskStatusSchema }),
  z.object({ kind: z.literal('assignee'), assigneeId: z.string().min(1).nullable() }),
  z.object({ kind: z.literal('priority'), priority: taskPrioritySchema }),
]);
export type BulkTaskOp = z.infer<typeof bulkOpSchema>;

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Apply one operation (status / assignee / priority) to many tasks at once.
 *
 * Authorization is PER TASK: each id is routed through the SAME gated lib
 * mutation the single-task UI uses (changeTaskStatus → canEditTask,
 * assignTask → canManageAssignments, updateTask → canEditTaskInternal), each of
 * which resolves the caller's effective per-project caps internally. A task the
 * caller can't act on (gate rejection, NOT_FOUND, or an invalid state
 * transition) is COUNTED as failed and skipped — the batch never aborts and one
 * forbidden task can never affect another. Returns a {succeeded, failed} tally.
 */
export async function bulkUpdateTasksAction(
  taskIds: string[],
  op: BulkTaskOp,
): Promise<ActionResult<{ succeeded: number; failed: number }>> {
  const me = await requireAuth();

  const parsed = bulkOpSchema.safeParse(op);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректная операция' } };
  }
  // Validate the id list with zod too (a 'use server' action receives whatever
  // the client POSTs — a non-array must fail closed, not throw a TypeError).
  const idsParsed = z.array(z.string().min(1)).safeParse(taskIds);
  if (!idsParsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный список задач' } };
  }
  const ids = Array.from(new Set(idsParsed.data));
  if (ids.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не выбрано ни одной задачи' } };
  }
  if (ids.length > MAX_BULK) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не более ${MAX_BULK} задач за раз` } };
  }

  const user = { id: me.id, role: me.role };
  const o = parsed.data;
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      if (o.kind === 'status') {
        await changeTaskStatus(id, o.status, user);
      } else if (o.kind === 'assignee') {
        await assignTask(id, o.assigneeId, user);
      } else {
        await updateTask(id, { priority: o.priority }, user);
      }
      succeeded++;
    } catch (e) {
      failed++;
      // DomainError = an expected per-task rejection (perms / not-found /
      // state). Anything else is unexpected — log but still don't abort.
      if (!(e instanceof DomainError)) {
        console.error('bulkUpdateTasksAction: item failed', id, e);
      }
    }
  }

  // The client router.refresh() updates the current view; revalidate the broader
  // projects tree so other cached board/list views reflect the change too.
  revalidatePath('/projects', 'layout');
  return { ok: true, data: { succeeded, failed } };
}
