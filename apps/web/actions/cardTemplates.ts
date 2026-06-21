'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { createTaskSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { canCreateTask, canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { createTask } from '@/lib/tasks/createTask';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const TASK_TYPES = ['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type TplType = (typeof TASK_TYPES)[number];
type TplPriority = (typeof PRIORITIES)[number];

export type CardTemplateInput = {
  id: string | null;
  name: string;
  title: string;
  description: string;
  type: TplType;
  priority: TplPriority;
};

/**
 * Reconcile a project's full set of card templates: insert new rows, update
 * kept ones (matched by id), delete the ones no longer present. Order follows
 * array position. Gated on project-edit permission (owner / PM / ADMIN / LEAD).
 */
export async function updateCardTemplatesAction(
  projectId: string,
  templates: CardTemplateInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  // Validate shape before touching the DB.
  for (const t of templates) {
    if (t.name.trim().length === 0) {
      return { ok: false, error: { code: 'VALIDATION', message: 'У каждого шаблона должно быть название' } };
    }
    if (!TASK_TYPES.includes(t.type) || !PRIORITIES.includes(t.priority)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Недопустимый тип или приоритет' } };
    }
  }

  const existing = await prisma.cardTemplate.findMany({
    where: { projectId },
    select: { id: true },
  });
  const keepIds = new Set(templates.map((t) => t.id).filter(Boolean) as string[]);
  const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.cardTemplate.deleteMany({ where: { id: { in: toDelete } } });
    }
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i]!;
      const data = {
        name: t.name.trim().slice(0, 120),
        title: t.title.trim().slice(0, 200),
        description: t.description.slice(0, 20_000),
        type: t.type,
        priority: t.priority,
        order: i,
      };
      if (t.id && keepIds.has(t.id)) {
        await tx.cardTemplate.update({ where: { id: t.id }, data });
      } else {
        await tx.cardTemplate.create({
          data: { ...data, projectId, createdById: me.id },
        });
      }
    }
  });

  revalidatePath(`/projects`);
  return { ok: true };
}

/**
 * Create a new task from a template and return its number so the caller can
 * navigate to it. Gated on task-create permission for the project.
 */
export async function createTaskFromTemplateAction(
  projectKey: string,
  templateId: string,
): Promise<ActionResult<{ number: number }>> {
  const me = await requireAuth();
  const tpl = await prisma.cardTemplate.findUnique({
    where: { id: templateId },
    select: {
      title: true,
      name: true,
      description: true,
      type: true,
      priority: true,
      project: {
        select: {
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!tpl || tpl.project.key !== projectKey) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Шаблон не найден' } };
  }
  if (!canCreateTask({ id: me.id, role: me.role }, tpl.project)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  // Title must satisfy the create schema (min 2 chars); fall back to the
  // template name when the default title is empty/too short.
  const rawTitle = tpl.title.trim();
  const title = rawTitle.length >= 2 ? rawTitle : tpl.name.trim();

  const input = createTaskSchema.parse({
    projectKey,
    title,
    description: tpl.description || undefined,
    type: tpl.type,
    priority: tpl.priority,
  });

  try {
    const task = await createTask(input, { id: me.id, role: me.role });
    revalidatePath(`/projects/${projectKey}/board`);
    return { ok: true, data: { number: task.number } };
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось создать задачу' } };
  }
}
