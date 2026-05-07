'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addCommentSchema,
  assignTaskSchema,
  changeStatusSchema,
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@giper/shared';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import {
  addComment,
  assignTask,
  changeTaskStatus,
  createTask,
  deleteTask,
  updateTask,
} from '@/lib/tasks';
import {
  pushBitrixCommentBestEffort,
  pushBitrixStatusBestEffort,
  publishTaskToBitrix,
} from '@/lib/integrations/bitrix24Outbound';
import {
  createNotification,
  fanoutToTaskAudience,
} from '@/lib/notifications/createNotifications';
import { extractValidMentions } from '@/lib/notifications/parseMentions';
import { publishTaskEvent } from '@/lib/realtime/publishTask';
import { canEditTaskInternal } from '@/lib/permissions';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };

function toErr(e: unknown): ActionResult {
  if (e instanceof DomainError) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  console.error('action error', e);
  return { ok: false, error: { code: 'INTERNAL', message: 'Что-то пошло не так' } };
}

function fromForm(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    obj[k] = v;
  });
  return obj;
}

// ----- Create -----------------------------------------------------------

export async function createTaskAction(
  projectKey: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ number: number }>> {
  const me = await requireAuth();
  const raw = { ...fromForm(formData), projectKey };
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  // Opt-in: publish to Bitrix24 immediately after create. Only valid
  // if the parent project is already mirrored — we check after the fact
  // and surface a clear error if not.
  const publishToBitrix = formData.get('publishToBitrix') === 'on';

  let createdNumber: number;
  let createdId: string;
  try {
    const created = await createTask(parsed.data as CreateTaskInput, {
      id: me.id,
      role: me.role,
    });
    createdNumber = created.number;
    createdId = created.id;
  } catch (e) {
    return toErr(e);
  }

  if (publishToBitrix) {
    const res = await publishTaskToBitrix(createdId);
    if (!res.ok) {
      revalidatePath(`/projects/${projectKey}`);
      revalidatePath(`/projects/${projectKey}/list`);
      return {
        ok: false,
        error: {
          code: 'PUBLISH_FAILED',
          message: `Задача создана, но не опубликована в Bitrix: ${res.error}`,
        },
      };
    }
  }

  revalidatePath(`/projects/${projectKey}`);
  revalidatePath(`/projects/${projectKey}/list`);
  redirect(`/projects/${projectKey}/tasks/${createdNumber}`);
}

/**
 * Manually publish an already-created local task to Bitrix24.
 * Requires the parent project to be mirrored already; if it isn't,
 * the user is told to publish the project first (we don't auto-cascade
 * because creating a workgroup is a meaningful side-effect).
 */
export async function publishTaskAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult<{ bitrixId: string }>> {
  const me = await requireAuth();
  // Same gate as edit — only people with edit rights can publish a
  // task to the client-facing system.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
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
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  }
  // Strict canEditTask refuses on already-mirrored tasks (which is fine
  // — they're already in Bitrix). For local tasks we want to allow the
  // publish; reuse canEditTaskInternal which doesn't veto on
  // externalSource. The publish helper itself is idempotent on already-
  // linked tasks.
  const allow =
    me.role === 'ADMIN' ||
    me.role === 'PM' ||
    task.creatorId === me.id ||
    task.assigneeId === me.id ||
    task.project.ownerId === me.id ||
    task.project.members.some((m) => m.userId === me.id && m.role === 'LEAD');
  if (!allow) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  const res = await publishTaskToBitrix(taskId);
  if (!res.ok) {
    return { ok: false, error: { code: 'PUBLISH_FAILED', message: res.error } };
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true, data: { bitrixId: res.bitrixId } };
}

// ----- Update fields -----------------------------------------------------

export async function updateTaskAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  input: Partial<UpdateTaskInput>,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    await updateTask(taskId, parsed.data as UpdateTaskInput, {
      id: me.id,
      role: me.role,
    });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  revalidatePath(`/projects/${projectKey}/list`);
  return { ok: true };
}

// ----- Change status ----------------------------------------------------

export async function changeStatusAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  rawStatus: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = changeStatusSchema.safeParse({ status: rawStatus });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Невалидный статус' } };
  }
  try {
    await changeTaskStatus(taskId, parsed.data.status, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
  // Outbound to Bitrix is best-effort — a failure shouldn't roll back the
  // user's local edit. We log + carry on; the task keeps its old
  // bitrixSyncedAt and will retry on the next status change. The webhook
  // path will still detect the divergence and surface a sync error.
  await pushBitrixStatusBestEffort(taskId);

  // Notify watchers / assignee / creator that the status moved.
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  await fanoutToTaskAudience(taskId, me.id, {
    kind: 'TASK_STATUS_CHANGED',
    title: `${me.name ?? 'Кто-то'} сменил(а) статус на ${parsed.data.status}`,
    link,
    payload: { taskId, status: parsed.data.status, projectKey, taskNumber },
  });
  // Live update for the task page + project board.
  void publishTaskEvent(taskId, {
    type: 'task:status-changed',
    taskId,
    status: parsed.data.status,
    actorId: me.id,
  });

  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  revalidatePath(`/projects/${projectKey}/list`);
  return { ok: true };
}

// ----- Assign -----------------------------------------------------------

export async function assignTaskAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  assigneeId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = assignTaskSchema.safeParse({ assigneeId });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Невалидный assignee' } };
  }
  try {
    await assignTask(taskId, parsed.data.assigneeId, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }

  // Ping the new assignee directly. Skip if they assigned themselves.
  if (parsed.data.assigneeId && parsed.data.assigneeId !== me.id) {
    await createNotification({
      userId: parsed.data.assigneeId,
      kind: 'TASK_ASSIGNED',
      title: `${me.name ?? 'Кто-то'} назначил(а) вас на задачу`,
      link: `/projects/${projectKey}/tasks/${taskNumber}`,
      payload: { taskId, projectKey, taskNumber },
    });
  }
  void publishTaskEvent(taskId, {
    type: 'task:assigned',
    taskId,
    assigneeId: parsed.data.assigneeId,
    actorId: me.id,
  });

  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  revalidatePath(`/projects/${projectKey}/list`);
  return { ok: true };
}

// ----- Comment ----------------------------------------------------------

export async function addCommentAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = addCommentSchema.safeParse({
    body: formData.get('body'),
    visibility: formData.get('visibility') ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  let comment;
  try {
    comment = await addComment(taskId, parsed.data.body, { id: me.id, role: me.role }, {
      visibility: parsed.data.visibility,
    });
  } catch (e) {
    return toErr(e);
  }
  // Push EXTERNAL comments to Bitrix; INTERNAL stays local-only.
  if (parsed.data.visibility === 'EXTERNAL') {
    await pushBitrixCommentBestEffort(comment.id);
  }

  // Notification fan-out — done after the comment is persisted so a
  // failure here doesn't lose the comment. We dedupe MENTION recipients
  // out of the broader fan-out so a mentioned watcher gets the more
  // specific MENTION notification, not also a generic TASK_COMMENTED.
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  const mentioned = await extractValidMentions(parsed.data.body);
  const mentionedSet = new Set(mentioned);
  for (const userId of mentioned) {
    if (userId === me.id) continue; // self-mention is a no-op
    await createNotification({
      userId,
      kind: 'MENTION',
      title: `${me.name ?? 'Кто-то'} упомянул(а) вас в комментарии`,
      body: parsed.data.body.slice(0, 200),
      link,
      payload: { taskId, commentId: comment.id, projectKey, taskNumber },
    });
  }
  // Generic comment fan-out to assignee/creator/watchers minus mentions.
  await fanoutToTaskAudience(
    taskId,
    me.id,
    {
      kind: 'TASK_COMMENTED',
      title: `${me.name ?? 'Кто-то'} прокомментировал(а) задачу`,
      body: parsed.data.body.slice(0, 200),
      link,
      payload: { taskId, commentId: comment.id, projectKey, taskNumber },
    },
    { excludeUserIds: [...mentionedSet] },
  );
  // Live update for everyone currently looking at the task.
  void publishTaskEvent(taskId, {
    type: 'comment:added',
    commentId: comment.id,
    authorId: me.id,
    mentionedUserIds: [...mentionedSet],
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

// ----- Delete -----------------------------------------------------------

export async function deleteTaskAction(
  taskId: string,
  projectKey: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    await deleteTask(taskId, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath(`/projects/${projectKey}`);
  revalidatePath(`/projects/${projectKey}/list`);
  redirect(`/projects/${projectKey}/list`);
}

// ----- Quick-add: minimal payload, last-used project memory ------------

type QuickAddInput = {
  projectKey: string;
  title: string;
  /** When set, the new task becomes a subtask of this id. */
  parentTaskId?: string;
};

/**
 * Fast path for the ⌘K / `c` quick-add popup. Equivalent to a full
 * createTask but without the redirect — the caller decides whether to
 * navigate to the new task or stay where they were.
 */
export async function quickAddTaskAction(
  input: QuickAddInput,
): Promise<ActionResult<{ number: number; projectKey: string }>> {
  const me = await requireAuth();
  const parsed = createTaskSchema.safeParse({
    projectKey: input.projectKey,
    title: input.title,
    parentId: input.parentTaskId,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    const created = await createTask(parsed.data as CreateTaskInput, {
      id: me.id,
      role: me.role,
    });
    revalidatePath(`/projects/${input.projectKey}`);
    revalidatePath(`/projects/${input.projectKey}/list`);
    return {
      ok: true,
      data: { number: created.number, projectKey: input.projectKey },
    };
  } catch (e) {
    return toErr(e);
  }
}

export type QuickAddProject = { id: string; key: string; name: string };

/**
 * Projects the current user can create tasks in. ADMIN/PM see all active
 * projects; everyone else sees only ones they own or are a member of.
 */
export async function listMyProjects(): Promise<QuickAddProject[]> {
  const me = await requireAuth();
  const where =
    me.role === 'ADMIN' || me.role === 'PM'
      ? { status: 'ACTIVE' as const }
      : {
          status: 'ACTIVE' as const,
          OR: [
            { ownerId: me.id },
            { members: { some: { userId: me.id } } },
          ],
        };
  return prisma.project.findMany({
    where,
    select: { id: true, key: true, name: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
}

// ----- Search (used by header timer widget) -----------------------------

export type TaskSearchHit = {
  id: string;
  number: number;
  title: string;
  projectKey: string;
};

/**
 * Search tasks by title across all projects the user can view.
 * Returns up to 10 hits. Min query length 2.
 */
export async function searchTasks(query: string): Promise<TaskSearchHit[]> {
  const me = await requireAuth();
  const q = query.trim();
  if (q.length < 2) return [];

  const where =
    me.role === 'ADMIN' || me.role === 'PM'
      ? {}
      : {
          OR: [
            { ownerId: me.id },
            { members: { some: { userId: me.id } } },
          ],
        };

  const tasks = await prisma.task.findMany({
    where: {
      title: { contains: q, mode: 'insensitive' as const },
      status: { not: 'CANCELED' },
      project: where,
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      number: true,
      title: true,
      project: { select: { key: true } },
    },
  });

  return tasks.map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    projectKey: t.project.key,
  }));
}

// ----- Bitrix24 sync conflict resolution --------------------------------

/**
 * Two-way sync resolution: when both sides changed a task between syncs,
 * we mark `syncConflict=true`. The user picks which side wins:
 *   - `local`  → push our current state to Bitrix and clear the flag.
 *   - `remote` → drop the flag (Bitrix value is already in our row from
 *                the inbound apply); essentially "accept their change".
 */
export async function resolveBitrixConflictAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  side: 'local' | 'remote',
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      externalSource: true,
      project: {
        select: {
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  if (task.externalSource !== 'bitrix24') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не bitrix-задача' } };
  }
  // Only people who can edit the task can choose how to resolve it.
  const canEdit =
    me.role === 'ADMIN' ||
    task.project.ownerId === me.id ||
    task.project.members.some((m) => m.userId === me.id && m.role === 'LEAD');
  if (!canEdit) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  if (side === 'local') {
    // Push our current state — pushBitrixStatusBestEffort updates the
    // hash and clears syncConflict on success.
    await pushBitrixStatusBestEffort(taskId);
  } else {
    // Accept remote — the inbound path already wrote the upstream value
    // to our row when it set the flag. Just clear the flag.
    await prisma.task.update({
      where: { id: taskId },
      data: { syncConflict: false },
    });
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

// ----- Reviewer assignment ---------------------------------------------

/**
 * Set or clear the task's reviewer. The reviewer is opt-in; without one,
 * REVIEW → DONE is gated only by `canEditTask`. With one, only that user
 * (or an ADMIN) can close.
 *
 * Permission: anyone who can edit the task can change the reviewer. The
 * reviewer themselves can also clear the field — useful when they realise
 * they can't get to it and the assignee should pick someone else.
 */
export async function setReviewerAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  reviewerId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      reviewerId: true,
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
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const isCurrentReviewerClearing =
    reviewerId === null && task.reviewerId === me.id;
  // Reviewer is an internal-track concept — fine to set on Bitrix-
  // mirrored tasks too.
  const canEdit = canEditTaskInternal({ id: me.id, role: me.role }, task);
  if (!canEdit && !isCurrentReviewerClearing) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  // The reviewer (if any) must be a project member. We don't enforce
  // that they can edit — read access is enough to look at the task and
  // approve.
  if (reviewerId) {
    const isMember =
      reviewerId === task.project.ownerId ||
      task.project.members.some((m) => m.userId === reviewerId);
    if (!isMember) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: 'Ревьюер должен быть участником проекта' },
      };
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { reviewerId },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}
