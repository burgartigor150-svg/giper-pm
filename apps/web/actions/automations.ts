'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma, type TaskStatus } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import type { ActionResult } from './projects';

const STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
];
const ACTION_TYPES = ['SET_ASSIGNEE', 'SET_PRIORITY', 'SET_SWIMLANE'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const MAX_NAME = 80;

export type AutomationActionKind = (typeof ACTION_TYPES)[number];

export type AutomationRuleInput = {
  id: string | null;
  name: string;
  enabled: boolean;
  /** What fires the rule. */
  triggerType: 'CARD_ENTERS_COLUMN' | 'TASK_CREATED';
  /** Column (status) whose entry fires the rule (CARD_ENTERS_COLUMN only). */
  triggerStatus: string;
  actionType: AutomationActionKind;
  /** userId (SET_ASSIGNEE) | priority (SET_PRIORITY) | swimlaneId or '' (SET_SWIMLANE). */
  actionValue: string;
  order: number;
};

/**
 * Reconcile a project's automation rules: update existing (by id), create new,
 * delete the rest. ADMIN / owner / LEAD only. Builds the stored trigger/action
 * JSON from the flattened input.
 */
export async function updateAutomationsAction(
  projectId: string,
  rules: AutomationRuleInput[],
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

  const existing = await prisma.automationRule.findMany({
    where: { projectId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((r) => r.id));

  type Clean = {
    id: string | null;
    name: string;
    enabled: boolean;
    trigger: 'CARD_ENTERS_COLUMN' | 'TASK_CREATED';
    triggerConfig: Prisma.InputJsonValue;
    actionType: AutomationActionKind;
    actionConfig: Prisma.InputJsonValue;
    order: number;
  };
  const clean: Clean[] = [];
  const keptIds = new Set<string>();
  for (const r of rules) {
    const name = (r.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название правила: 1–${MAX_NAME} символов` },
      };
    }
    const isColumnTrigger = r.triggerType !== 'TASK_CREATED';
    if (isColumnTrigger && !STATUSES.includes(r.triggerStatus as TaskStatus)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Неверная колонка-триггер' } };
    }
    if (!ACTION_TYPES.includes(r.actionType)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Неверное действие' } };
    }
    let actionConfig: Prisma.InputJsonValue;
    if (r.actionType === 'SET_ASSIGNEE') {
      if (!r.actionValue) {
        return { ok: false, error: { code: 'VALIDATION', message: `«${name}»: выберите исполнителя` } };
      }
      actionConfig = { userId: r.actionValue };
    } else if (r.actionType === 'SET_PRIORITY') {
      if (!PRIORITIES.includes(r.actionValue)) {
        return { ok: false, error: { code: 'VALIDATION', message: `«${name}»: выберите приоритет` } };
      }
      actionConfig = { priority: r.actionValue };
    } else {
      // SET_SWIMLANE — empty value means "no lane".
      actionConfig = { swimlaneId: r.actionValue || null };
    }
    const id = r.id && existingIds.has(r.id) ? r.id : null;
    if (id) keptIds.add(id);
    const order = Number.isFinite(r.order) ? Math.floor(Number(r.order)) : 0;
    clean.push({
      id,
      name,
      enabled: !!r.enabled,
      trigger: isColumnTrigger ? 'CARD_ENTERS_COLUMN' : 'TASK_CREATED',
      triggerConfig: isColumnTrigger ? { status: r.triggerStatus } : {},
      actionType: r.actionType,
      actionConfig,
      order,
    });
  }

  const toDelete = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id);

  try {
    await prisma.$transaction([
      ...clean.map((r) =>
        r.id
          ? prisma.automationRule.update({
              where: { id: r.id },
              data: {
                name: r.name,
                enabled: r.enabled,
                trigger: r.trigger,
                triggerConfig: r.triggerConfig,
                actionType: r.actionType,
                actionConfig: r.actionConfig,
                order: r.order,
              },
            })
          : prisma.automationRule.create({
              data: {
                projectId,
                name: r.name,
                enabled: r.enabled,
                trigger: r.trigger,
                triggerConfig: r.triggerConfig,
                actionType: r.actionType,
                actionConfig: r.actionConfig,
                order: r.order,
              },
            }),
      ),
      ...(toDelete.length > 0
        ? [prisma.automationRule.deleteMany({ where: { id: { in: toDelete } } })]
        : []),
    ]);
  } catch (e) {
    console.error('updateAutomationsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить правила' } };
  }

  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}
