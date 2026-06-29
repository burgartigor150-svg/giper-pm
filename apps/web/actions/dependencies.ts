'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal, canViewTask } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import type { TaskLinkType } from '@giper/db';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

const LINK_TYPES: readonly TaskLinkType[] = ['BLOCKS', 'RELATES_TO', 'DUPLICATES'];

/**
 * Add a directed task↔task link of the given kind (default BLOCKS). Both tasks
 * must be visible to the actor and `from` must be editable (same trust level as
 * editing it). For BLOCKS only, cycles are rejected: if a BLOCKS path already
 * exists from `to` back to `from`, the new edge would close a cycle and we
 * refuse. RELATES_TO / DUPLICATES are non-blocking, so they can't form a
 * blocking cycle and skip that check.
 *
 * Cycle detection: bounded DFS from `to` along BLOCKS edges looking for `from`.
 * Edges are sparse in practice, so this is cheap. Capped at 200 nodes.
 */
export async function addDependencyAction(
  fromTaskId: string,
  toTaskId: string,
  projectKey: string,
  taskNumber: number,
  linkType: TaskLinkType = 'BLOCKS',
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!LINK_TYPES.includes(linkType)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неизвестный тип связи' } };
  }
  if (fromTaskId === toTaskId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Задача не может ссылаться сама на себя' } };
  }

  const from = await prisma.task.findUnique({
    where: { id: fromTaskId },
    select: {
      id: true,
      projectId: true,
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
  // Dependencies are an internal-only track (never round-trip to Bitrix), so
  // they're editable on mirror tasks too — internal gate, matching the UI.
  if (!canEditTaskInternal({ id: me.id, role: me.role }, from, await getEffectiveCapsForProject({ id: me.id, role: me.role }, from.projectId))) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  // The target must be VISIBLE to the actor — otherwise linking to an arbitrary
  // id would leak the foreign task's key/title/status into the actor's
  // dependency list (cross-project IDOR). Load the full canViewTask projection.
  const to = await prisma.task.findUnique({
    where: { id: toTaskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      reviewerId: true,
      testerId: true,
      assignments: { select: { userId: true } },
      watchers: { select: { userId: true } },
      project: {
        select: {
          ownerId: true,
          externalSource: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  // Same opaque NOT_FOUND for "doesn't exist" and "exists but you can't see it"
  // so the endpoint never confirms a foreign task's existence.
  if (!to || !canViewTask({ id: me.id, role: me.role }, to)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Целевая задача не найдена' } };
  }

  if (linkType === 'BLOCKS' && (await wouldCreateCycle(fromTaskId, toTaskId))) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Создаст цикл — A→B и B→A одновременно недопустимо' },
    };
  }

  try {
    await prisma.taskDependency.create({
      data: { fromTaskId, toTaskId, linkType, createdById: me.id },
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
          projectId: true,
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
  if (!canEditTaskInternal({ id: me.id, role: me.role }, dep.fromTask, await getEffectiveCapsForProject({ id: me.id, role: me.role }, dep.fromTask.projectId))) {
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
      where: { fromTaskId: current, linkType: 'BLOCKS' },
      select: { toTaskId: true },
    });
    for (const e of edges) stack.push(e.toTaskId);
  }
  return false;
}
