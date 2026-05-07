'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTask } from '@/lib/permissions';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

/**
 * Add a "from blocks to" dependency edge. Both tasks must be visible to
 * the actor and `from` must be editable (it's the task that's adding a
 * blocker — same trust level as editing it). Cycles are rejected: if a
 * path already exists from `to` back to `from`, the new edge would close
 * a cycle and we refuse.
 *
 * Cycle detection: bounded DFS from `to` looking for `from`. Edges are
 * sparse in practice (few blockers per task), so this is cheap. We cap
 * traversal at 200 nodes for safety.
 */
export async function addDependencyAction(
  fromTaskId: string,
  toTaskId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (fromTaskId === toTaskId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Задача не может блокировать саму себя' } };
  }

  const from = await prisma.task.findUnique({
    where: { id: fromTaskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      project: {
        select: {
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!from) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTask({ id: me.id, role: me.role }, from)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  const to = await prisma.task.findUnique({
    where: { id: toTaskId },
    select: { id: true },
  });
  if (!to) return { ok: false, error: { code: 'NOT_FOUND', message: 'Целевая задача не найдена' } };

  if (await wouldCreateCycle(fromTaskId, toTaskId)) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Создаст цикл — A→B и B→A одновременно недопустимо' },
    };
  }

  try {
    await prisma.taskDependency.create({
      data: { fromTaskId, toTaskId, createdById: me.id },
    });
  } catch (e) {
    // Unique constraint = duplicate edge. Treat as success (idempotent).
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      return { ok: true };
    }
    throw e;
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

export async function removeDependencyAction(
  dependencyId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const dep = await prisma.taskDependency.findUnique({
    where: { id: dependencyId },
    select: {
      fromTask: {
        select: {
          id: true,
          creatorId: true,
          assigneeId: true,
          externalSource: true,
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true, role: true } },
            },
          },
        },
      },
    },
  });
  if (!dep) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  if (!canEditTask({ id: me.id, role: me.role }, dep.fromTask)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  await prisma.taskDependency.delete({ where: { id: dependencyId } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

/**
 * Returns true if adding `from → to` would close a cycle. We DFS from
 * `to` along outgoing BLOCKS edges and check whether `from` is reachable.
 * Visited set prevents re-traversal in case the existing graph already
 * contains cycles (it shouldn't, but be defensive).
 */
async function wouldCreateCycle(fromId: string, toId: string): Promise<boolean> {
  const visited = new Set<string>();
  const stack = [toId];
  let safety = 0;
  while (stack.length > 0 && safety < 200) {
    safety++;
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (current === fromId) return true;
    const edges = await prisma.taskDependency.findMany({
      where: { fromTaskId: current },
      select: { toTaskId: true },
    });
    for (const e of edges) stack.push(e.toTaskId);
  }
  return false;
}
