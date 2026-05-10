'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addMemberSchema,
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
  type AddMemberInput,
} from '@giper/shared';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import {
  addProjectMember,
  archiveProject,
  createProject,
  removeProjectMember,
  updateProject,
} from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { publishProjectToBitrix } from '@/lib/integrations/bitrix24Outbound';
import { createNotification } from '@/lib/notifications/createNotifications';

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

function parseFormToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    obj[k] = typeof v === 'string' ? v : v;
  });
  return obj;
}

export async function createProjectAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ key: string }>> {
  const user = await requireAuth();
  const parsed = createProjectSchema.safeParse(parseFormToObject(formData));
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
  // Optional opt-in: publish to Bitrix24 right after create.
  const publishToBitrix = formData.get('publishToBitrix') === 'on';

  let createdKey: string;
  let createdId: string;
  try {
    const project = await createProject(parsed.data as CreateProjectInput, {
      id: user.id,
      role: user.role,
    });
    createdKey = project.key;
    createdId = project.id;
  } catch (e) {
    return toErr(e);
  }

  if (publishToBitrix) {
    const res = await publishProjectToBitrix(createdId);
    if (!res.ok) {
      // Project is created but publish failed — surface the error
      // without losing the row. The user can retry from the project
      // page via the "Опубликовать в Bitrix" button.
      revalidatePath('/projects');
      return {
        ok: false,
        error: {
          code: 'PUBLISH_FAILED',
          message: `Проект создан, но не опубликован в Bitrix: ${res.error}`,
        },
      };
    }
  }

  revalidatePath('/projects');
  redirect(`/projects/${createdKey}`);
}

/**
 * "Quick create" used by the Telegram-integration wizard (and any
 * other place that needs to spin up a project inline without leaving
 * the current page). Same validation + permissions as
 * `createProjectAction`, but returns the created `{key, name}` instead
 * of redirecting.
 */
export async function createProjectQuickAction({
  key,
  name,
  description,
}: {
  key: string;
  name: string;
  description?: string;
}): Promise<{ ok: true; project: { key: string; name: string } } | { ok: false; message: string }> {
  const user = await requireAuth();
  const parsed = createProjectSchema.safeParse({
    key,
    name,
    description: description?.trim() || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const first =
      fieldErrors.key?.[0] ||
      fieldErrors.name?.[0] ||
      fieldErrors.description?.[0] ||
      'Проверьте поля';
    return { ok: false, message: first };
  }
  try {
    const project = await createProject(parsed.data as CreateProjectInput, {
      id: user.id,
      role: user.role,
    });
    revalidatePath('/projects');
    revalidatePath('/integrations/telegram');
    return { ok: true, project: { key: project.key, name: project.name } };
  } catch (e) {
    if (e instanceof DomainError) {
      return { ok: false, message: e.message };
    }
    // eslint-disable-next-line no-console
    console.error('createProjectQuickAction', e);
    return { ok: false, message: 'Не удалось создать проект' };
  }
}

/**
 * Manually publish an already-created local project to Bitrix24.
 * Used by the "Опубликовать в Bitrix" button on the project page —
 * either when the user didn't tick the checkbox at create time, or
 * when an earlier auto-publish failed and they're retrying.
 *
 * Idempotent: if the project is already linked to Bitrix24, returns
 * success without doing anything.
 */
export async function publishProjectAction(
  projectId: string,
): Promise<ActionResult<{ bitrixId: string }>> {
  const user = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  }
  if (!canEditProject({ id: user.id, role: user.role }, project)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  const res = await publishProjectToBitrix(projectId);
  if (!res.ok) {
    return { ok: false, error: { code: 'PUBLISH_FAILED', message: res.error } };
  }
  revalidatePath(`/projects/${project.key}`);
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true, data: { bitrixId: res.bitrixId } };
}

export async function updateProjectAction(
  projectId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = updateProjectSchema.safeParse(parseFormToObject(formData));
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
    await updateProject(projectId, parsed.data as UpdateProjectInput, {
      id: user.id,
      role: user.role,
    });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await archiveProject(projectId, { id: user.id, role: user.role });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function addProjectMemberAction(
  projectId: string,
  input: AddMemberInput,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Невалидный ввод' } };
  }
  try {
    await addProjectMember(projectId, parsed.data, { id: user.id, role: user.role });
  } catch (e) {
    return toErr(e);
  }
  // Ping the new member that they're now in the project — except when
  // someone added themselves.
  if (parsed.data.userId !== user.id) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { key: true, name: true },
    });
    if (project) {
      await createNotification({
        userId: parsed.data.userId,
        kind: 'SYSTEM',
        title: `${user.name ?? 'Кто-то'} добавил(а) вас в проект «${project.name}»`,
        link: `/projects/${project.key}`,
        payload: { projectId, role: parsed.data.role },
      });
    }
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function removeProjectMemberAction(
  projectId: string,
  userIdToRemove: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await removeProjectMember(projectId, userIdToRemove, { id: user.id, role: user.role });
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/projects');
  return { ok: true };
}

// ----- WIP limits ------------------------------------------------------

const VALID_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
] as const;

/**
 * Set or clear WIP-limits for a project's kanban columns. Soft-limits:
 * we never block status transitions, just paint the column header red
 * when its task count exceeds the value. `null` for any status removes
 * the limit.
 *
 * Permissions: ADMIN, project owner, or project LEAD — same gate as
 * other project-meta edits.
 */
export async function setWipLimitsAction(
  projectId: string,
  limits: Record<string, number | null>,
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      key: true,
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

  // Sanitize: drop unknown keys and coerce values to positive ints (or null).
  const clean: Record<string, number> = {};
  for (const status of VALID_STATUSES) {
    const v = limits[status];
    if (v == null) continue;
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0 && n < 1000) {
      clean[status] = n;
    }
  }
  await prisma.project.update({
    where: { id: projectId },
    data: {
      wipLimits:
        Object.keys(clean).length > 0
          ? (clean as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
  revalidatePath(`/projects/${project.key}`);
  revalidatePath(`/projects/${project.key}/board`);
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}
