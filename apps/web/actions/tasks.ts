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
  let createdNumber: number;
  try {
    const created = await createTask(parsed.data as CreateTaskInput, {
      id: me.id,
      role: me.role,
    });
    createdNumber = created.number;
  } catch (e) {
    return toErr(e);
  }
  revalidatePath(`/projects/${projectKey}`);
  revalidatePath(`/projects/${projectKey}/list`);
  redirect(`/projects/${projectKey}/tasks/${createdNumber}`);
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
  const parsed = addCommentSchema.safeParse({ body: formData.get('body') });
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
    await addComment(taskId, parsed.data.body, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
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
