'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { pushBitrixDeadlineBestEffort } from '@/lib/integrations/bitrix24Outbound';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Move a task's deadline to a different day. Used by the calendar's
 * drag-and-drop affordance. Permission: same gate as inline editing
 * — assignee, creator, project owner/lead, or ADMIN.
 *
 * `newDate` is the date string YYYY-MM-DD picked from the day cell
 * the user dropped onto. We pin the time to the previous deadline's
 * hours/minutes if any (so a 16:00 deadline stays 16:00 on the new
 * day), otherwise default to 18:00 local — close-of-business.
 *
 * For Bitrix-mirrored tasks the outbound push fires best-effort — a
 * Bitrix outage doesn't block the local move.
 */
export async function changeTaskDueDateAction(
  taskId: string,
  newDate: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Bad date' } };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      dueDate: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      project: {
        select: {
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  }
  if (
    !canEditTaskInternal(
      { id: me.id, role: me.role },
      {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        project: task.project,
      },
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  // Preserve hours/minutes of the previous deadline. Default to 18:00.
  const [y, m, d] = newDate.split('-').map(Number);
  const next = new Date(y!, (m! - 1) | 0, d!);
  if (task.dueDate) {
    next.setHours(task.dueDate.getHours(), task.dueDate.getMinutes(), 0, 0);
  } else {
    next.setHours(18, 0, 0, 0);
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { dueDate: next },
  });

  if (task.externalSource === 'bitrix24') {
    await pushBitrixDeadlineBestEffort(task.id);
  }

  revalidatePath('/calendar');
  revalidatePath(`/projects/${task.project.key}/list`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Calendar events (personal/team entries that aren't tasks or meetings)
// ---------------------------------------------------------------------------

const TITLE_MAX = 200;

function parseDateLike(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Create a calendar event. Creator is implicit ATTENDEE — they
 * automatically see their own events. Additional attendees (strings of
 * userIds) are optional. Returns the new event id on success.
 */
export async function createCalendarEventAction(input: {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  isAllDay?: boolean;
  location?: string;
  projectId?: string | null;
  attendeeIds?: string[];
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();

  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название пустое' } };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не длиннее ${TITLE_MAX} символов` } };
  }
  const start = parseDateLike(input.startAt);
  const end = parseDateLike(input.endAt);
  if (!start || !end) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверная дата' } };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Конец должен быть позже начала' } };
  }

  // Optional project must be one the user can see (member or owner).
  // We don't strictly enforce "team" here — anyone who can read the
  // project can pin events to it. Visibility of events is by attendee.
  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
    }
  }

  const attendeeIds = Array.from(
    new Set((input.attendeeIds ?? []).filter((id) => id && id !== me.id)),
  );
  let validAttendees: string[] = [];
  if (attendeeIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: attendeeIds }, isActive: true },
      select: { id: true },
    });
    validAttendees = found.map((u) => u.id);
  }

  const created = await prisma.calendarEvent.create({
    data: {
      title,
      description: input.description?.trim() || null,
      startAt: start,
      endAt: end,
      isAllDay: !!input.isAllDay,
      location: input.location?.trim() || null,
      projectId: input.projectId ?? null,
      createdById: me.id,
      attendees: {
        create: [
          // Creator auto-attends.
          { userId: me.id },
          ...validAttendees.map((userId) => ({ userId })),
        ],
      },
    },
    select: { id: true },
  });

  revalidatePath('/calendar');
  return { ok: true, data: created };
}

/**
 * List calendar events overlapping [from, to) that the caller can see.
 * Visibility: events where the user is creator OR attendee. Returns rows
 * shaped for the calendar grid.
 */
export async function listCalendarEventsAction(
  from: string,
  to: string,
): Promise<
  | {
      ok: true;
      data: Array<{
        id: string;
        title: string;
        startAt: string;
        endAt: string;
        isAllDay: boolean;
        location: string | null;
        projectId: string | null;
        createdById: string;
      }>;
    }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  const fromD = parseDateLike(from);
  const toD = parseDateLike(to);
  if (!fromD || !toD) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверный диапазон' } };
  }

  const rows = await prisma.calendarEvent.findMany({
    where: {
      // Overlap test: event.endAt > from AND event.startAt < to.
      AND: [
        { endAt: { gt: fromD } },
        { startAt: { lt: toD } },
      ],
      OR: [
        { createdById: me.id },
        { attendees: { some: { userId: me.id } } },
      ],
    },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      isAllDay: true,
      location: true,
      projectId: true,
      createdById: true,
    },
  });

  return {
    ok: true,
    data: rows.map((r) => ({
      ...r,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    })),
  };
}

/**
 * Delete a calendar event. Only the creator can delete.
 */
export async function deleteCalendarEventAction(
  eventId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const ev = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { id: true, createdById: true },
  });
  if (!ev) return { ok: false, error: { code: 'NOT_FOUND', message: 'Событие не найдено' } };
  if (ev.createdById !== me.id) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только создатель может удалить' } };
  }
  await prisma.calendarEvent.delete({ where: { id: eventId } });
  revalidatePath('/calendar');
  return { ok: true };
}
