'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import type { ActionResult } from './projects';

const MAX_TITLE = 200;

type Me = Awaited<ReturnType<typeof requireAuth>>;

async function loadProjectForEdit(projectId: string, me: Me) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) return { ok: false as const, code: 'NOT_FOUND', msg: 'Проект не найден' };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, projectId),
    )
  ) {
    return { ok: false as const, code: 'INSUFFICIENT_PERMISSIONS', msg: 'Недостаточно прав' };
  }
  return { ok: true as const, key: project.key };
}

/** Create an empty document and jump into it. ADMIN / owner / LEAD only. */
export async function createDocumentAction(
  projectId: string,
  parentId: string | null = null,
): Promise<void> {
  const me = await requireAuth();
  const gate = await loadProjectForEdit(projectId, me);
  if (!gate.ok) return;
  const doc = await prisma.document.create({
    data: {
      projectId,
      title: 'Без названия',
      content: '',
      parentId: parentId ?? null,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath(`/projects/${gate.key}/docs`);
  redirect(`/projects/${gate.key}/docs/${doc.id}`);
}

/** Save a document's title + content. */
export async function updateDocumentAction(
  docId: string,
  title: string,
  content: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { projectId: true },
  });
  if (!doc) return { ok: false, error: { code: 'NOT_FOUND', message: 'Документ не найден' } };
  const gate = await loadProjectForEdit(doc.projectId, me);
  if (!gate.ok) return { ok: false, error: { code: gate.code, message: gate.msg } };

  const cleanTitle = (title ?? '').trim().slice(0, MAX_TITLE) || 'Без названия';
  try {
    await prisma.document.update({
      where: { id: docId },
      data: { title: cleanTitle, content: content ?? '' },
    });
  } catch (e) {
    console.error('updateDocumentAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить' } };
  }
  revalidatePath(`/projects/${gate.key}/docs/${docId}`);
  revalidatePath(`/projects/${gate.key}/docs`);
  return { ok: true };
}

/** Delete a document (and its nested children via the FK cascade). */
export async function deleteDocumentAction(docId: string): Promise<void> {
  const me = await requireAuth();
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { projectId: true },
  });
  if (!doc) return;
  const gate = await loadProjectForEdit(doc.projectId, me);
  if (!gate.ok) return;
  await prisma.document.delete({ where: { id: docId } });
  revalidatePath(`/projects/${gate.key}/docs`);
  redirect(`/projects/${gate.key}/docs`);
}
