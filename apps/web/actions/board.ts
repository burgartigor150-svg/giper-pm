'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type TaskStatus } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import type { ActionResult } from './projects';

const VALID_STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
];

const MAX_NAME = 60;
const MAX_WIP = 999;

export type BoardColumnInput = {
  status: TaskStatus;
  name: string;
  /** Card-count WIP limit; null = no limit. */
  wipLimit: number | null;
  /** Left → right display order. */
  order: number;
};

/**
 * Upsert a project's board columns (name, order, per-column WIP) keyed by
 * status. Columns map 1:1 to TaskStatus (`@@unique[projectId, status]`), so
 * this both creates columns for a project still on synthesized defaults and
 * updates existing ones in a single transaction.
 *
 * Permissions: ADMIN, project owner, or project LEAD — same gate as other
 * board/project-meta edits.
 */
export async function updateBoardColumnsAction(
  projectId: string,
  columns: BoardColumnInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  }
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  // Sanitize: one entry per valid status, trimmed non-empty name, WIP a
  // positive int under the cap (or null), integer order.
  const seen = new Set<TaskStatus>();
  const clean: BoardColumnInput[] = [];
  for (const c of columns) {
    if (!VALID_STATUSES.includes(c.status) || seen.has(c.status)) continue;
    const name = (c.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название колонки: 1–${MAX_NAME} символов` },
      };
    }
    seen.add(c.status);
    let wipLimit: number | null = null;
    if (c.wipLimit != null) {
      const n = Math.floor(Number(c.wipLimit));
      if (Number.isFinite(n) && n > 0 && n <= MAX_WIP) wipLimit = n;
    }
    const order = Number.isFinite(c.order) ? Math.floor(Number(c.order)) : 0;
    clean.push({ status: c.status, name, wipLimit, order });
  }
  if (clean.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет колонок для сохранения' } };
  }

  try {
    await prisma.$transaction(
      clean.map((c) =>
        prisma.boardColumn.upsert({
          where: { projectId_status: { projectId, status: c.status } },
          create: {
            projectId,
            status: c.status,
            name: c.name,
            order: c.order,
            wipLimit: c.wipLimit,
          },
          update: { name: c.name, order: c.order, wipLimit: c.wipLimit },
        }),
      ),
    );
  } catch (e) {
    console.error('updateBoardColumnsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить колонки' } };
  }

  revalidatePath(`/projects/${project.key}`);
  revalidatePath(`/projects/${project.key}/board`);
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}
