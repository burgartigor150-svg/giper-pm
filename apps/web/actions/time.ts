'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  editTimeEntrySchema,
  logTimeSchema,
  type EditTimeEntryInput,
  type LogTimeInput,
} from '@giper/shared';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import {
  deleteTimeEntry,
  editTimeEntry,
  getActiveTimer,
  logTimeManually,
  startTimer,
  stopTimer,
} from '@/lib/time';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };

function toErr<T = unknown>(e: unknown): ActionResult<T> {
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

// ----- Live timer ------------------------------------------------------

export async function getActiveTimerAction() {
  const me = await requireAuth();
  return getActiveTimer(me.id);
}

export async function startTimerAction(taskId: string): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    await startTimer(taskId, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function stopTimerAction(): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    await stopTimer(me.id);
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

// ----- Manual log ------------------------------------------------------

export async function logTimeAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ flag: string | null }>> {
  const me = await requireAuth();
  const parsed = logTimeSchema.safeParse(parseFormForLog(formData));
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
    const entry = await logTimeManually(parsed.data as LogTimeInput, {
      id: me.id,
      role: me.role,
    });
    revalidatePath('/time');
    return { ok: true, data: { flag: entry.flag } };
  } catch (e) {
    return toErr(e);
  }
}

/** Combine date + time inputs into ISO strings for zod parsing. */
function parseFormForLog(formData: FormData): Record<string, unknown> {
  const obj = fromForm(formData);
  const date = String(obj.date ?? '');
  const startTime = String(obj.startTime ?? '');
  const endTime = String(obj.endTime ?? '');
  if (date && startTime) obj.startedAt = `${date}T${startTime}:00`;
  if (date && endTime) obj.endedAt = `${date}T${endTime}:00`;
  return obj;
}

// ----- Edit / delete ---------------------------------------------------

export async function editTimeEntryAction(
  entryId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = editTimeEntrySchema.safeParse(parseFormForLog(formData));
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
    await editTimeEntry(entryId, parsed.data as EditTimeEntryInput, {
      id: me.id,
      role: me.role,
    });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/time');
  redirect('/time');
}

export async function deleteTimeEntryAction(entryId: string): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    await deleteTimeEntry(entryId, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/time');
  return { ok: true };
}

// ----- Bulk reassign ----------------------------------------------------

/**
 * Move many time entries to a different task in one shot. Common use:
 * "I logged 5 hours against the wrong project this morning, fix all at
 * once" without having to open each entry's edit form.
 *
 * Permissions: an entry can be reassigned by its owner or by an ADMIN.
 * The destination task must be visible to the owner (we use the entry's
 * userId, not the actor's, so an ADMIN reassigning someone else's entry
 * still respects that user's project membership).
 */
export async function bulkReassignTimeEntriesAction(
  entryIds: string[],
  newTaskId: string,
): Promise<ActionResult<{ updated: number }>> {
  const me = await requireAuth();
  if (entryIds.length === 0) {
    return { ok: true, data: { updated: 0 } };
  }
  if (entryIds.length > 200) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Слишком много записей за раз' } };
  }

  // Pull entries with owner + current task to validate.
  const entries = await prisma.timeEntry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, userId: true },
  });
  if (entries.length !== entryIds.length) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Часть записей не найдена' } };
  }
  // ADMIN can move anyone; otherwise actor must own all selected entries.
  if (me.role !== 'ADMIN') {
    const foreign = entries.find((e) => e.userId !== me.id);
    if (foreign) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Можно переносить только свои записи' },
      };
    }
  }

  // Validate destination task is visible to each affected user.
  const targetTask = await prisma.task.findUnique({
    where: { id: newTaskId },
    select: {
      id: true,
      project: {
        select: {
          ownerId: true,
          members: { select: { userId: true } },
        },
      },
    },
  });
  if (!targetTask) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Целевая задача не найдена' } };
  }
  const allowedUserIds = new Set<string>([targetTask.project.ownerId]);
  for (const m of targetTask.project.members) allowedUserIds.add(m.userId);
  for (const e of entries) {
    if (!allowedUserIds.has(e.userId)) {
      return {
        ok: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'У одного из авторов нет доступа к целевому проекту',
        },
      };
    }
  }

  const result = await prisma.timeEntry.updateMany({
    where: { id: { in: entryIds } },
    data: { taskId: newTaskId },
  });
  revalidatePath('/time');
  revalidatePath('/me');
  return { ok: true, data: { updated: result.count } };
}

// ----- Auto-stopped entry resolution ------------------------------------

/**
 * Three ways the user can deal with an entry that the timer guard
 * auto-closed:
 *
 *   - keep    → leave it as-is, just clear the AUTO_STOPPED flag so it
 *               stops nagging in the day timeline.
 *   - trim    → keep the row but set endedAt earlier (e.g. user knows
 *               they actually stopped working at 14:30 even though the
 *               timer ran until 16:00). `trimToMinutes` is the new
 *               duration in minutes from startedAt.
 *   - delete  → drop the row entirely (it was a forgotten timer over
 *               lunch / overnight, none of it was real work).
 */
export async function resolveAutoStoppedAction(
  entryId: string,
  resolution: 'keep' | 'trim' | 'delete',
  trimToMinutes?: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      flag: true,
    },
  });
  if (!entry) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Запись не найдена' } };
  }
  // Only the entry's owner (or ADMIN) can resolve it. We don't allow
  // PMs to reach into someone else's day from this affordance — the
  // /time bulk-edit page is the right place for cross-user fixes.
  if (entry.userId !== me.id && me.role !== 'ADMIN') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  if (entry.flag !== 'AUTO_STOPPED') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Запись не auto-stopped' } };
  }

  if (resolution === 'delete') {
    await prisma.timeEntry.delete({ where: { id: entry.id } });
  } else if (resolution === 'trim') {
    const minutes = Math.max(1, Math.floor(trimToMinutes ?? 0));
    if (!Number.isFinite(minutes) || minutes < 1) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Минимум 1 минута' } };
    }
    const newEndedAt = new Date(entry.startedAt.getTime() + minutes * 60_000);
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt: newEndedAt,
        durationMin: minutes,
        flag: null,
      },
    });
  } else {
    // keep — accept the auto-stopped duration but drop the flag so it
    // doesn't keep showing as "needs attention".
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { flag: null },
    });
  }

  revalidatePath('/me');
  revalidatePath('/time');
  return { ok: true };
}

// ----- Inline task time entry ------------------------------------------

/**
 * Lightweight time-log action used straight from the task page sidebar.
 * Inputs:
 *   - hours: decimal (0.25 step typical), required.
 *   - date:  YYYY-MM-DD; defaults to today. Used as the day the work
 *            happened — we synthesise an entry from the start of that
 *            day (09:00 local) for `hours` duration so the entry has a
 *            concrete startedAt/endedAt that the rest of the system
 *            already understands. The actual hour boundaries don't
 *            matter for any report; only the duration and date do.
 *   - note:  optional free text up to ~500 chars.
 *
 * Permission: any task viewer can log their own time. Same model as
 * the timer — the user is recording what THEY did, attributing time
 * to someone else doesn't make sense from this affordance.
 *
 * Lifecycle: we don't update Task.startedAt / completedAt here. Those
 * are status-driven and shouldn't move just because someone logged
 * retroactive hours.
 */
export async function logTaskHoursAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  hours: number,
  date?: string,
  note?: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Часы должны быть от 0 до 24' },
    };
  }
  // Round to nearest minute so the duration matches what the user typed.
  const minutes = Math.max(1, Math.round(hours * 60));

  // Synthesise start/end. Default day = today; pin start at 09:00 local
  // to keep entries clustered visibly in /me timeline. The math doesn't
  // mind which clock hour we pick — it's the date and duration that
  // matter for everything downstream.
  const day = date ? new Date(date) : new Date();
  if (Number.isNaN(day.getTime())) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверная дата' } };
  }
  const startedAt = new Date(day);
  startedAt.setHours(9, 0, 0, 0);
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

  try {
    const entry = await logTimeManually(
      {
        taskId,
        startedAt,
        endedAt,
        note: note?.trim() || undefined,
      } as LogTimeInput,
      { id: me.id, role: me.role },
    );
    revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
    revalidatePath('/time');
    revalidatePath('/me');
    return { ok: true, data: { id: entry.id } };
  } catch (e) {
    const r = toErr(e);
    // Re-tag so the typed return is satisfied — toErr's loose
    // ActionResult<unknown> doesn't unify with the narrow data type.
    return r as ActionResult<{ id: string }>;
  }
}

/**
 * List recent time entries for a task — used to render a small log
 * under the "log hours" form on the task page so the assignee can see
 * their own (and the team's) recent contributions.
 */
export async function listTaskTimeEntries(
  taskId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    durationMin: number | null;
    note: string | null;
    source: string;
    user: { id: string; name: string; image: string | null };
  }>
> {
  await requireAuth();
  return prisma.timeEntry.findMany({
    where: { taskId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      durationMin: true,
      note: true,
      source: true,
      user: { select: { id: true, name: true, image: true } },
    },
  });
}
