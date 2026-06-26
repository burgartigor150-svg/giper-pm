import { prisma, type TaskStatus } from '@giper/db';
import { statusSeedId } from '@giper/shared';
import { DomainError } from '../errors';
import { internalStatusWrite } from '../status/refs';
import type { SessionUser } from '../permissions';
import { isTransitionAllowed } from '../workflow/isTransitionAllowed';
import { isClosing as isClosingCat, isTerminal, statusCategory } from '../status/category';
import { autoUnblockDependents } from './autoTransitions';
import { assertWipNotExceeded } from '../board/assertWipNotExceeded';
import { runColumnEnterAutomations } from '../automations/runColumnEnterAutomations';
import { dispatchWebhooks } from '../webhooks/dispatchWebhooks';
import { closeBitrixTaskBestEffort } from '../integrations/bitrix24Outbound';

const VALID: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
];

/**
 * Change a task's INTERNAL (team-board) status — the workflow track that is
 * editable even on Bitrix-mirrored tasks (unlike the read-only mirror status).
 *
 * Accepts an explicit actor so both the server action and the MCP server can
 * reuse it. Enforces the same gate as the board (ADMIN/PM/creator/assignee/
 * owner/LEAD) and the project's configurable transition allowlist, then runs
 * the standard side effects (auto-unblock dependants, column-enter automations,
 * outgoing webhooks). Returns the project key + number for revalidation.
 *
 * Throws DomainError on bad status / not found / forbidden / blocked transition.
 */
export async function setInternalStatus(
  taskId: string,
  status: string,
  user: SessionUser,
  opts: { result?: string; columnId?: string; skipWip?: boolean } = {},
): Promise<{ projectKey: string; number: number }> {
  if (!VALID.includes(status as TaskStatus)) {
    throw new DomainError('VALIDATION', 400, 'Невалидный статус');
  }
  const result = opts.result?.trim();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      number: true,
      title: true,
      projectId: true,
      internalStatus: true,
      completedAt: true,
      externalSource: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404, 'Не найдено');

  // Same gate as the board's setInternalStatusAction — ignores the
  // externalSource veto on purpose (internal edits are allowed on mirrors).
  const allow =
    user.role === 'ADMIN' ||
    user.role === 'PM' ||
    task.creatorId === user.id ||
    task.assigneeId === user.id ||
    task.project.ownerId === user.id ||
    task.project.members.some((m) => m.userId === user.id && m.role === 'LEAD');
  if (!allow) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Недостаточно прав');

  // No-op when already in this status: don't re-run side effects, don't demand
  // a result again, and don't post a second "Итог" comment on a re-close.
  if (task.internalStatus === status) {
    return { projectKey: task.project.key, number: task.number };
  }

  // Closing a task (→ DONE) requires a result/итог. Enforced in the core so the
  // UI, the MCP server, and any other caller share the rule. Only reached on a
  // real transition into DONE (the no-op guard above already returned).
  const cat = statusCategory(status as TaskStatus);
  const isClosing = isClosingCat(cat);
  if (isClosing && !result) {
    throw new DomainError('VALIDATION', 400, 'Нужно указать итог при закрытии задачи');
  }

  if (!(await isTransitionAllowed(task.projectId, task.internalStatus, status as TaskStatus))) {
    throw new DomainError(
      'TRANSITION_NOT_ALLOWED',
      400,
      'Переход запрещён правилами рабочего процесса проекта',
    );
  }

  const isMirror = task.externalSource === 'bitrix24';
  // S2 dual-write: keep the internal-track FKs (internalStatusId + columnId) in
  // step with the enum, and the mirror FK when a close also flips the mirror.
  const internalFk = await internalStatusWrite(prisma, task.projectId, status as TaskStatus);
  // WIP: the card enters the target column for the new category — enforce its
  // limit server-side (the board checks client-side, but the card picker / MCP
  // bypass it). The free-form board move passes skipWip because setTaskColumnAction
  // checks the EXPLICIT target column (this lookup resolves only the default one).
  if (!opts.skipWip) {
    await assertWipNotExceeded(
      task.projectId,
      { columnId: internalFk.columnId, status: status as TaskStatus },
      taskId,
    );
  }
  await prisma.task.update({
    where: { id: taskId },
    data: {
      internalStatus: status as TaskStatus,
      ...internalFk,
      ...(isClosing
        ? {
            completionResult: result,
            completedAt: task.completedAt ?? new Date(),
            // Closing here closes it in Bitrix too → reflect DONE on the mirror
            // status so pushTaskStatus sends STATUS=5 and the two tracks agree
            // (the inbound echo is recognised by the synced-hash and skipped).
            ...(isMirror ? { status: 'DONE' as TaskStatus, statusId: statusSeedId(task.projectId, 'DONE') } : {}),
          }
        : {}),
    },
  });

  // Kaiten parity: when a card first ENTERS an "in progress / done" column and
  // has no responsible yet, the actor who moved it becomes the responsible
  // (assignee). Queue categories (BACKLOG/TODO) and CANCELED never auto-assign,
  // and an existing assignee is never overwritten — this only fills an empty slot
  // on a real category transition (the no-op guard above already returned).
  const startsWork = cat !== 'BACKLOG' && cat !== 'TODO' && cat !== 'CANCELED';
  if (startsWork && !task.assigneeId) {
    await prisma.task.update({ where: { id: taskId }, data: { assigneeId: user.id } });
  }

  if (isTerminal(cat)) {
    await autoUnblockDependents(taskId, user.id);
  }
  // Pass the destination column (when the caller is a free-form board move) so
  // per-column automation rules can fire too; category rules fire regardless.
  await runColumnEnterAutomations(taskId, status, opts.columnId);
  await dispatchWebhooks(task.projectId, 'card.moved', {
    project: { id: task.projectId, key: task.project.key },
    task: { id: taskId, number: task.number, title: task.title, toStatus: status },
  });

  if (isClosing) {
    // Record the итог as an EXTERNAL comment so it shows in the timeline and can
    // sync to Bitrix. Raw create (not addComment) on purpose: the actor already
    // passed the close gate above, which is broader than canViewTask.
    const comment = await prisma.comment.create({
      data: {
        taskId,
        authorId: user.id,
        body: `Итог: ${result}`,
        source: 'WEB',
        visibility: 'EXTERNAL',
      },
      select: { id: true },
    });
    // Best-effort: close in Bitrix (STATUS=5) + post the итог comment + mark it
    // as the native Bitrix "Result". No-op for native tasks / no webhook URL.
    await closeBitrixTaskBestEffort(taskId, comment.id);
  }

  return { projectKey: task.project.key, number: task.number };
}
