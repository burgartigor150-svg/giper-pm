import { prisma, type TaskStatus } from '@giper/db';
import { statusCategory, isTerminal, isClosing, startsWork } from '../status/category';
import { internalStatusWrite } from '../status/refs';
import { autoUnblockDependents } from './autoTransitions';
import { fanoutToTaskAudience } from '../notifications/createNotifications';

/** Synthetic итог stamped when a parent auto-closes (keeps completionResult non-empty). */
export const AUTO_PARENT_DONE_RESULT = 'Закрыто автоматически: все подзадачи выполнены';

/** Ancestor-climb bound (matches getTaskGraph) — parentId has no DB acyclic constraint. */
const MAX_DEPTH = 8;

/**
 * Parent rollup (Kaiten parity, opt-in via Project.autoMoveParentOnChild):
 * after a child's internalStatus changes, advance its parent FORWARD only —
 *   → IN_PROGRESS when a subtask has started and the parent is still in the
 *     queue (BACKLOG/TODO);
 *   → DONE when every non-canceled subtask is DONE (and at least one is DONE;
 *     an all-canceled parent is "abandoned" and left for a human). Only a parent
 *     in BACKLOG/TODO/IN_PROGRESS auto-closes — REVIEW (reviewer gate) and
 *     BLOCKED are human-managed and never auto-closed.
 *
 * WRITE-DIRECT, like the other auto-transitions: it bypasses the итог gate (a
 * synthetic completionResult is supplied), WIP (assertWipNotExceeded), the
 * transition allowlist, and the Bitrix push (the mirror `status` is NEVER
 * touched and closeBitrixTaskBestEffort is never called), and fires no
 * webhook/automation for the parent move. The only side effects are a fanout
 * ping and autoUnblockDependents on a terminal parent. Forward-only: never moves
 * the parent backward / cancels / reopens. Best-effort: never throws (a failed
 * rollup must not undo the child's committed status change). Recurses up the
 * parent chain, bounded by depth + a visited set.
 */
export async function rollupParentFromChild(
  childTaskId: string,
  actorId: string,
  opts: { depth?: number; visited?: Set<string> } = {},
): Promise<void> {
  const depth = opts.depth ?? 0;
  const visited = opts.visited ?? new Set<string>();
  if (depth >= MAX_DEPTH || visited.has(childTaskId)) return;
  visited.add(childTaskId);

  try {
    const child = await prisma.task.findUnique({
      where: { id: childTaskId },
      select: { parentId: true, projectId: true },
    });
    if (!child?.parentId) return;

    const parent = await prisma.task.findUnique({
      where: { id: child.parentId },
      select: {
        id: true,
        projectId: true,
        internalStatus: true,
        completedAt: true,
        startedAt: true,
        number: true,
        project: { select: { key: true, autoMoveParentOnChild: true } },
      },
    });
    if (!parent) return;
    // Cross-project parent (allowed for Bitrix-synced subtasks): skip + stop the
    // climb — only roll up within one project.
    if (parent.projectId !== child.projectId) return;
    if (!parent.project.autoMoveParentOnChild) return; // opt-in (default OFF)

    const parentCat = statusCategory(parent.internalStatus);

    // Aggregate over the parent's children (the moved child's siblings).
    const siblings = await prisma.task.findMany({
      where: { parentId: parent.id },
      select: { internalStatus: true },
    });
    let open = 0;
    let done = 0;
    let anyStarted = false;
    for (const s of siblings) {
      const c = statusCategory(s.internalStatus);
      if (!isTerminal(c)) open++; // not DONE and not CANCELED
      if (isClosing(c)) done++; // DONE
      if (startsWork(c)) anyStarted = true;
    }

    // → DONE: every non-canceled subtask is DONE (and at least one is DONE).
    // CANCELED subtasks are excluded from the denominator, like SubtaskList.
    // Only auto-close a parent in a NON-gated active/queue state — REVIEW (the
    // reviewer sign-off gate) and BLOCKED are human-managed and never auto-closed,
    // and a terminal parent (DONE/CANCELED) is never advanced (forward-only).
    const canAutoDone =
      parentCat === 'BACKLOG' || parentCat === 'TODO' || parentCat === 'IN_PROGRESS';
    if (canAutoDone && open === 0 && done >= 1) {
      const next: TaskStatus = 'DONE';
      await prisma.task.update({
        where: { id: parent.id },
        data: {
          internalStatus: next,
          ...(await internalStatusWrite(prisma, parent.projectId, next)),
          // Stamp a start time too if it skipped IN_PROGRESS (BACKLOG/TODO→DONE),
          // so throughput/cycle-time aren't skewed by a done-without-start parent.
          startedAt: parent.startedAt ?? new Date(),
          completedAt: parent.completedAt ?? new Date(), // first-close-wins
          completionResult: AUTO_PARENT_DONE_RESULT,
        },
      });
      await autoUnblockDependents(parent.id, actorId).catch(() => {});
      await fanoutToTaskAudience(parent.id, actorId, {
        kind: 'TASK_STATUS_CHANGED',
        title: 'Задача закрыта автоматически — все подзадачи выполнены',
        link: `/projects/${parent.project.key}/tasks/${parent.number}`,
        payload: { taskId: parent.id, internalStatus: next, auto: true },
      }).catch(() => {});
      await rollupParentFromChild(parent.id, actorId, { depth: depth + 1, visited });
      return;
    }

    // → IN_PROGRESS: a subtask has started and the parent is still in the queue.
    if ((parentCat === 'BACKLOG' || parentCat === 'TODO') && anyStarted) {
      const next: TaskStatus = 'IN_PROGRESS';
      await prisma.task.update({
        where: { id: parent.id },
        data: {
          internalStatus: next,
          ...(await internalStatusWrite(prisma, parent.projectId, next)),
          startedAt: parent.startedAt ?? new Date(),
        },
      });
      await fanoutToTaskAudience(parent.id, actorId, {
        kind: 'TASK_STATUS_CHANGED',
        title: 'Работа над задачей началась — по подзадаче',
        link: `/projects/${parent.project.key}/tasks/${parent.number}`,
        payload: { taskId: parent.id, internalStatus: next, auto: true },
      }).catch(() => {});
      await rollupParentFromChild(parent.id, actorId, { depth: depth + 1, visited });
      return;
    }
  } catch (e) {
    console.warn('rollupParentFromChild failed', childTaskId, e);
  }
}
