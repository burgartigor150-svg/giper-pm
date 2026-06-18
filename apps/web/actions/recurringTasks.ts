'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const TASK_TYPES = ['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type TplType = (typeof TASK_TYPES)[number];
type TplPriority = (typeof PRIORITIES)[number];

export type RecurringTaskInput = {
  id: string | null;
  title: string;
  type: TplType;
  priority: TplPriority;
  intervalDays: number;
  /** YYYY-MM-DD anchor for the next run (created at 09:00 MSK that day). */
  startDate: string;
  active: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD into a Date at 09:00 Moscow time (06:00 UTC). */
function parseNextRun(startDate: string): Date | null {
  if (!DATE_RE.test(startDate)) return null;
  const d = new Date(`${startDate}T09:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reconcile a project's full set of recurring cards. Gated on project-edit
 * permission. Each row's nextRunAt is (re)derived from its startDate, so the
 * form should seed startDate from the stored nextRunAt to keep schedules
 * stable across unrelated edits.
 */
export async function updateRecurringTasksAction(
  projectId: string,
  rows: RecurringTaskInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  // Validate every row up front — no partial writes.
  const prepared: Array<{ row: RecurringTaskInput; nextRunAt: Date; interval: number }> = [];
  for (const r of rows) {
    if (r.title.trim().length < 2) {
      return { ok: false, error: { code: 'VALIDATION', message: 'У повторяющейся карточки нужно название (≥2 символов)' } };
    }
    if (!TASK_TYPES.includes(r.type) || !PRIORITIES.includes(r.priority)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Недопустимый тип или приоритет' } };
    }
    const interval = Math.floor(Number(r.intervalDays));
    if (!Number.isFinite(interval) || interval < 1 || interval > 3650) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Интервал — целое число дней (1–3650)' } };
    }
    const nextRunAt = parseNextRun(r.startDate);
    if (!nextRunAt) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Некорректная дата старта' } };
    }
    prepared.push({ row: r, nextRunAt, interval });
  }

  const existing = await prisma.recurringTask.findMany({
    where: { projectId },
    select: { id: true },
  });
  const keepIds = new Set(rows.map((r) => r.id).filter(Boolean) as string[]);
  const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.recurringTask.deleteMany({ where: { id: { in: toDelete } } });
    }
    for (const { row, nextRunAt, interval } of prepared) {
      const data = {
        title: row.title.trim().slice(0, 200),
        type: row.type,
        priority: row.priority,
        intervalDays: interval,
        nextRunAt,
        active: row.active,
      };
      if (row.id && keepIds.has(row.id)) {
        await tx.recurringTask.update({ where: { id: row.id }, data });
      } else {
        await tx.recurringTask.create({
          data: { ...data, projectId, createdById: me.id },
        });
      }
    }
  });

  revalidatePath(`/projects`);
  return { ok: true };
}
