'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { isSafeWebhookUrl } from '@/lib/webhooks/ssrfGuard';
import { WEBHOOK_EVENT_SET } from '@/lib/webhooks/events';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

function validate(url: string, events: string[]): string | null {
  if (!/^https:\/\//i.test(url.trim())) return 'URL должен начинаться с https://';
  if (!isSafeWebhookUrl(url.trim())) return 'Недопустимый или внутренний адрес';
  if (events.length === 0) return 'Выберите хотя бы одно событие';
  if (events.some((e) => !WEBHOOK_EVENT_SET.has(e))) return 'Неизвестное событие';
  return null;
}

async function canEditProjectId(userId: string, role: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return null;
  if (
    !canEditProject(
      { id: userId, role: role as never },
      project,
      await getEffectiveCapsForProject({ id: userId, role: role as never }, projectId),
    )
  )
    return null;
  return project;
}

/** Create a webhook for a project. Returns the generated signing secret once. */
export async function createWebhookAction(
  projectId: string,
  url: string,
  events: string[],
): Promise<ActionResult<{ secret: string }>> {
  const me = await requireAuth();
  const project = await canEditProjectId(me.id, me.role, projectId);
  if (!project) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };

  const err = validate(url, events);
  if (err) return { ok: false, error: { code: 'VALIDATION', message: err } };

  const secret = crypto.randomBytes(24).toString('hex');
  await prisma.webhook.create({
    data: {
      projectId,
      url: url.trim().slice(0, 2000),
      secret,
      events,
      createdById: me.id,
    },
  });
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true, data: { secret } };
}

/** Update a webhook's url / events / active flag. */
export async function updateWebhookAction(
  webhookId: string,
  url: string,
  events: string[],
  active: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { projectId: true, project: { select: { key: true } } },
  });
  if (!hook) return { ok: false, error: { code: 'NOT_FOUND', message: 'Вебхук не найден' } };
  const project = await canEditProjectId(me.id, me.role, hook.projectId);
  if (!project) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };

  const err = validate(url, events);
  if (err) return { ok: false, error: { code: 'VALIDATION', message: err } };

  await prisma.webhook.update({
    where: { id: webhookId },
    data: { url: url.trim().slice(0, 2000), events, active },
  });
  revalidatePath(`/projects/${hook.project.key}/settings`);
  return { ok: true };
}

/** Delete a webhook. */
export async function deleteWebhookAction(webhookId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { projectId: true, project: { select: { key: true } } },
  });
  if (!hook) return { ok: true };
  const project = await canEditProjectId(me.id, me.role, hook.projectId);
  if (!project) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };

  try {
    await prisma.webhook.delete({ where: { id: webhookId } });
  } catch {
    return { ok: false, error: { code: 'DB_ERROR', message: 'Не удалось удалить вебхук' } };
  }
  revalidatePath(`/projects/${hook.project.key}/settings`);
  return { ok: true };
}
