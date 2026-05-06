'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  editTimeEntrySchema,
  logTimeSchema,
  type EditTimeEntryInput,
  type LogTimeInput,
} from '@giper/shared';
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
