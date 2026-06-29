import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';
import { setInternalStatus } from './setInternalStatus';
import { runColumnEnterAutomations } from '../automations/runColumnEnterAutomations';
import { isColumnTransitionAllowed } from '../workflow/isColumnTransitionAllowed';
import { assertWipNotExceeded } from '../board/assertWipNotExceeded';
import { DomainError } from '../errors';

/**
 * Move ONE task to a specific board column — the shared core behind
 * setTaskColumnAction (single-card DnD) and the bulk board-move action
 * (bulkMoveTasksOnBoardAction).
 *
 * Lives in a plain lib module (NOT a 'use server' file) on purpose: it takes a
 * trusted `user` argument, so it must never be exposed as a client-callable
 * server action. The 'use server' wrappers (setTaskColumnAction) resolve the
 * caller via requireAuth() and pass it in.
 *
 * THROWS DomainError on every rejection (NOT_FOUND / INSUFFICIENT_PERMISSIONS /
 * VALIDATION / WIP_EXCEEDED / TRANSITION_NOT_ALLOWED) so a bulk caller can count
 * a failure and continue instead of aborting the batch. Does NOT revalidate —
 * the caller picks the path to refresh; the project key is returned for that.
 */
export async function moveTaskToColumn(
  taskId: string,
  columnId: string,
  user: SessionUser,
): Promise<{ projectKey: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      internalStatus: true,
      columnId: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404, 'Задача не найдена');
  // Board move gate — same stakeholder/leadership predicate as setInternalStatus
  // (the status core). The cross-category branch below re-checks it inside
  // setInternalStatus, but the same-category fast path skips the core, so gate
  // here too or it would be an unauthenticated-edit (IDOR) hole.
  const allow =
    user.role === 'ADMIN' ||
    user.role === 'PM' ||
    task.creatorId === user.id ||
    task.assigneeId === user.id ||
    task.project.ownerId === user.id ||
    task.project.members.some((m) => m.userId === user.id && m.role === 'LEAD');
  if (!allow) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Недостаточно прав');
  const col = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: { projectId: true, status: true, statusId: true },
  });
  if (!col || col.projectId !== task.projectId) {
    throw new DomainError('VALIDATION', 400, 'Колонка не найдена');
  }
  // WIP: entering a DIFFERENT column → enforce the EXPLICIT target column's
  // limit up-front, before any write, so a rejected move commits nothing. The
  // cross-category core call below gets skipWip so it doesn't ALSO check the
  // default column the category resolves to.
  if (task.columnId !== columnId) {
    await assertWipNotExceeded(task.projectId, { columnId, status: col.status }, taskId);
  }
  if (task.internalStatus !== col.status) {
    // Category change → the workflow-gated core enforces the transition + runs
    // side effects (it also rejects a forbidden move / a DONE without an итог).
    // Thread the destination columnId so per-column automation rules fire too.
    await setInternalStatus(taskId, col.status, user, { columnId, skipWip: true });
    await prisma.task.update({
      where: { id: taskId },
      data: { columnId, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
    });
  } else {
    // Same-category move (e.g. «Code Review» → «QA», both REVIEW). The category
    // engine doesn't see this move, so enforce the per-column transition
    // allowlist here (inert when the project has no column rules). Reject
    // BEFORE writing anything so a denied move commits nothing.
    if (!(await isColumnTransitionAllowed(task.projectId, task.columnId, columnId))) {
      throw new DomainError(
        'TRANSITION_NOT_ALLOWED',
        409,
        'Переход между колонками запрещён правилами рабочего процесса',
      );
    }
    // Re-pin the column only — internalStatus / startedAt / completedAt /
    // TaskStatusChange are deliberately left untouched so reports, burndown,
    // versions and the mirror stay correct. The status core is skipped, so fire
    // the column-enter automations here (best-effort; never throws) —
    // historically this move fired nothing at all. columnRulesOnly: the card
    // entered a new COLUMN but not a new CATEGORY, so only the destination
    // column's rules run; a category-keyed rule must not re-fire on an
    // intra-category shuffle.
    await prisma.task.update({
      where: { id: taskId },
      data: { columnId, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
    });
    await runColumnEnterAutomations(taskId, col.status, columnId, { columnRulesOnly: true });
  }
  return { projectKey: task.project.key };
}
