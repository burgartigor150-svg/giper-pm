'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma, type CustomFieldType } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import type { ActionResult } from './projects';

const FIELD_TYPES: readonly CustomFieldType[] = [
  'TEXT',
  'NUMBER',
  'DATE',
  'CHECKBOX',
  'SELECT',
  'MULTI_SELECT',
  'URL',
];
const MAX_NAME = 60;
const MAX_OPTIONS = 50;

export type CustomFieldInput = {
  /** Existing definition id, or null to create. */
  id: string | null;
  name: string;
  type: CustomFieldType;
  /** Options for SELECT / MULTI_SELECT; ignored otherwise. */
  options: string[];
  order: number;
};

/**
 * Reconcile a project's custom field definitions: update existing (by id),
 * create new (id === null), delete the rest. Deleting a definition cascades to
 * its values via the FK. ADMIN / owner / LEAD only.
 */
export async function updateCustomFieldsAction(
  projectId: string,
  fields: CustomFieldInput[],
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

  const existing = await prisma.customFieldDefinition.findMany({
    where: { projectId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((f) => f.id));

  type Clean = {
    id: string | null;
    name: string;
    type: CustomFieldType;
    options: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    order: number;
  };
  const clean: Clean[] = [];
  const keptIds = new Set<string>();
  for (const f of fields) {
    const name = (f.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название поля: 1–${MAX_NAME} символов` },
      };
    }
    if (!FIELD_TYPES.includes(f.type)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Неверный тип поля' } };
    }
    const isChoice = f.type === 'SELECT' || f.type === 'MULTI_SELECT';
    let options: string[] = [];
    if (isChoice) {
      options = (f.options ?? [])
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
        .slice(0, MAX_OPTIONS);
      if (options.length === 0) {
        return {
          ok: false,
          error: { code: 'VALIDATION', message: `«${name}»: укажите хотя бы один вариант` },
        };
      }
    }
    const id = f.id && existingIds.has(f.id) ? f.id : null;
    if (id) keptIds.add(id);
    const order = Number.isFinite(f.order) ? Math.floor(Number(f.order)) : 0;
    clean.push({
      id,
      name,
      type: f.type,
      options: isChoice ? options : Prisma.JsonNull,
      order,
    });
  }

  const toDelete = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id);

  try {
    await prisma.$transaction([
      ...clean.map((f) =>
        f.id
          ? prisma.customFieldDefinition.update({
              where: { id: f.id },
              data: { name: f.name, type: f.type, options: f.options, order: f.order },
            })
          : prisma.customFieldDefinition.create({
              data: {
                projectId,
                name: f.name,
                type: f.type,
                options: f.options,
                order: f.order,
              },
            }),
      ),
      ...(toDelete.length > 0
        ? [prisma.customFieldDefinition.deleteMany({ where: { id: { in: toDelete } } })]
        : []),
    ]);
  } catch (e) {
    console.error('updateCustomFieldsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить поля' } };
  }

  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}

/**
 * Set (or clear, with empty string) a task's value for one custom field.
 * Allowed for project editors (ADMIN/owner/LEAD) or task stakeholders
 * (assignee / creator / reviewer) — the people actually working the task.
 */
export async function setCustomFieldValueAction(
  taskId: string,
  fieldId: string,
  value: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      number: true,
      assigneeId: true,
      creatorId: true,
      reviewerId: true,
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
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  }
  const isStakeholder =
    task.assigneeId === me.id || task.creatorId === me.id || task.reviewerId === me.id;
  if (!isStakeholder && !canEditProject({ id: me.id, role: me.role }, task.project)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  const field = await prisma.customFieldDefinition.findUnique({
    where: { id: fieldId },
    select: { projectId: true, type: true, options: true },
  });
  if (!field || field.projectId !== task.projectId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Поле не найдено' } };
  }

  const trimmed = (value ?? '').trim();
  // Empty clears the value.
  if (trimmed === '') {
    await prisma.customFieldValue.deleteMany({ where: { fieldId, taskId } });
    revalidatePath(`/projects/${task.project.key}/tasks/${task.number}`);
    return { ok: true };
  }

  // Light per-type validation.
  if (field.type === 'NUMBER' && !Number.isFinite(Number(trimmed))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Ожидается число' } };
  }
  if (field.type === 'CHECKBOX' && trimmed !== 'true' && trimmed !== 'false') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Ожидается true/false' } };
  }
  const opts = Array.isArray(field.options) ? (field.options as string[]) : [];
  if (field.type === 'SELECT' && !opts.includes(trimmed)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Значение вне списка' } };
  }

  try {
    await prisma.customFieldValue.upsert({
      where: { fieldId_taskId: { fieldId, taskId } },
      create: { fieldId, taskId, value: trimmed },
      update: { value: trimmed },
    });
  } catch (e) {
    console.error('setCustomFieldValueAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить значение' } };
  }
  revalidatePath(`/projects/${task.project.key}/tasks/${task.number}`);
  return { ok: true };
}
