import { prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';
import type { SessionUser } from '../permissions';
import { isTransitionAllowed } from '../workflow/isTransitionAllowed';
import { autoUnblockDependents } from './autoTransitions';
import { runColumnEnterAutomations } from '../automations/runColumnEnterAutomations';
import { dispatchWebhooks } from '../webhooks/dispatchWebhooks';

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
): Promise<{ projectKey: string; number: number }> {
  if (!VALID.includes(status as TaskStatus)) {
    throw new DomainError('VALIDATION', 400, 'Невалидный статус');
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      number: true,
      title: true,
      projectId: true,
      internalStatus: true,
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

  if (!(await isTransitionAllowed(task.projectId, task.internalStatus, status as TaskStatus))) {
    throw new DomainError(
      'TRANSITION_NOT_ALLOWED',
      400,
      'Переход запрещён правилами рабочего процесса проекта',
    );
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { internalStatus: status as TaskStatus },
  });

  if (status === 'DONE' || status === 'CANCELED') {
    await autoUnblockDependents(taskId, user.id);
  }
  await runColumnEnterAutomations(taskId, status);
  await dispatchWebhooks(task.projectId, 'card.moved', {
    project: { id: task.projectId, key: task.project.key },
    task: { id: taskId, number: task.number, title: task.title, toStatus: status },
  });

  return { projectKey: task.project.key, number: task.number };
}
