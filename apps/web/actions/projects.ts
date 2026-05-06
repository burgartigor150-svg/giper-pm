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
import { requireAuth } from '@/lib/auth';
import {
  addProjectMember,
  archiveProject,
  createProject,
  removeProjectMember,
  updateProject,
} from '@/lib/projects';
import { DomainError } from '@/lib/errors';

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
  let createdKey: string;
  try {
    const project = await createProject(parsed.data as CreateProjectInput, {
      id: user.id,
      role: user.role,
    });
    createdKey = project.key;
  } catch (e) {
    return toErr(e);
  }
  revalidatePath('/projects');
  redirect(`/projects/${createdKey}`);
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
