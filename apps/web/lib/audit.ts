import { prisma, type Prisma } from '@giper/db';

type AuditAction =
  | 'task.create'
  | 'task.update'
  | 'task.status_change'
  | 'task.assign'
  | 'task.delete';

/**
 * Append an audit entry. Records only the changed keys in `diff` (before/after).
 * Never logs raw description blobs — only "changed: true" for description.
 */
export async function auditTask(params: {
  action: AuditAction;
  taskId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  userId: string;
}) {
  const { action, taskId, before, after, userId } = params;

  let diff: Prisma.InputJsonValue | undefined;
  if (action === 'task.update' && before && after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of keys) {
      const a = (before as Record<string, unknown>)[k];
      const b = (after as Record<string, unknown>)[k];
      if (!shallowEqual(a, b)) {
        if (k === 'description') {
          changed[k] = { from: '<changed>', to: '<changed>' };
        } else {
          changed[k] = { from: a as unknown, to: b as unknown };
        }
      }
    }
    if (Object.keys(changed).length === 0) return;
    diff = changed as Prisma.InputJsonValue;
  } else if (before || after) {
    diff = { before: before ?? null, after: after ?? null } as Prisma.InputJsonValue;
  }

  await prisma.auditLog.create({
    data: {
      userId,
      entity: 'Task',
      entityId: taskId,
      action,
      diff,
    },
  });
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
}
