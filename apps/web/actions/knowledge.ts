'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

// KB is org-wide. v1 access model:
//   • read     — any authenticated user (enforced at the page).
//   • articles — any non-VIEWER may create/edit/move/delete.
//   • spaces   — ADMIN/PM only (structural).
// Per-space roles arrive in a later slice.
const canManageSpaces = (role: string) => role === 'ADMIN' || role === 'PM';
const canEditArticles = (role: string) => role !== 'VIEWER';

async function nextOrder(where: { spaceId: string; parentId: string | null }): Promise<number> {
  const max = await prisma.knowledgeArticle.aggregate({ where, _max: { order: true } });
  return (max._max.order ?? -1) + 1;
}

// ---- Spaces ---------------------------------------------------------------

export async function createSpaceAction(
  name: string,
  icon?: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  const title = name.trim() || 'Новое пространство';
  const max = await prisma.knowledgeSpace.aggregate({ _max: { order: true } });
  const space = await prisma.knowledgeSpace.create({
    data: { name: title, icon: icon?.trim() || null, order: (max._max.order ?? -1) + 1, createdById: me.id },
    select: { id: true },
  });
  revalidatePath('/knowledge');
  return { ok: true, data: { id: space.id } };
}

export async function updateSpaceAction(
  id: string,
  patch: { name?: string; icon?: string | null; color?: string | null; description?: string | null },
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  await prisma.knowledgeSpace.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Без названия' } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    },
  });
  revalidatePath('/knowledge');
  return { ok: true };
}

export async function deleteSpaceAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  await prisma.knowledgeSpace.delete({ where: { id } });
  revalidatePath('/knowledge');
  return { ok: true };
}

// ---- Articles -------------------------------------------------------------

export async function createArticleAction(
  spaceId: string,
  parentId: string | null,
  title?: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEditArticles(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  const space = await prisma.knowledgeSpace.findUnique({ where: { id: spaceId }, select: { id: true } });
  if (!space) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пространство не найдено' } };
  const order = await nextOrder({ spaceId, parentId: parentId ?? null });
  const article = await prisma.knowledgeArticle.create({
    data: {
      spaceId,
      parentId: parentId ?? null,
      title: title?.trim() || 'Без названия',
      order,
      createdById: me.id,
      updatedById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/knowledge');
  return { ok: true, data: { id: article.id } };
}

export async function updateArticleAction(
  id: string,
  patch: { title?: string; content?: string; icon?: string | null },
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditArticles(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.knowledgeArticle.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || 'Без названия' } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      updatedById: me.id,
    },
  });
  revalidatePath('/knowledge');
  return { ok: true };
}

/** Move/reparent an article (tree drag or "move to"). Guards against self/loop. */
export async function moveArticleAction(
  id: string,
  parentId: string | null,
  order: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditArticles(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (parentId === id) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нельзя вложить в саму себя' } };
  }
  // Reject moving under one's own descendant (cycle).
  let cur = parentId;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur === id) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Нельзя вложить в свою подстатью' } };
    }
    const p: { parentId: string | null } | null = await prisma.knowledgeArticle.findUnique({
      where: { id: cur },
      select: { parentId: true },
    });
    cur = p?.parentId ?? null;
  }
  await prisma.knowledgeArticle.update({
    where: { id },
    data: { parentId: parentId ?? null, order },
  });
  revalidatePath('/knowledge');
  return { ok: true };
}

export async function deleteArticleAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditArticles(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.knowledgeArticle.delete({ where: { id } });
  revalidatePath('/knowledge');
  return { ok: true };
}

/** Toggle DRAFT ⇄ PUBLISHED. */
export async function setArticleStatusAction(
  id: string,
  status: 'DRAFT' | 'PUBLISHED',
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditArticles(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.knowledgeArticle.update({ where: { id }, data: { status, updatedById: me.id } });
  revalidatePath('/knowledge');
  return { ok: true };
}

// ---- Favorites ------------------------------------------------------------
// Any authenticated user may star (read-level personalisation, no role gate).

export async function toggleFavoriteArticleAction(
  articleId: string,
): Promise<ActionResult<{ favorited: boolean }>> {
  const me = await requireAuth();
  const existing = await prisma.knowledgeFavorite.findUnique({
    where: { userId_articleId: { userId: me.id, articleId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.knowledgeFavorite.delete({ where: { id: existing.id } });
    revalidatePath('/knowledge');
    return { ok: true, data: { favorited: false } };
  }
  await prisma.knowledgeFavorite.create({ data: { userId: me.id, articleId } });
  revalidatePath('/knowledge');
  return { ok: true, data: { favorited: true } };
}

export async function toggleFavoriteSpaceAction(
  spaceId: string,
): Promise<ActionResult<{ favorited: boolean }>> {
  const me = await requireAuth();
  const existing = await prisma.knowledgeFavorite.findUnique({
    where: { userId_spaceId: { userId: me.id, spaceId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.knowledgeFavorite.delete({ where: { id: existing.id } });
    revalidatePath('/knowledge');
    return { ok: true, data: { favorited: false } };
  }
  await prisma.knowledgeFavorite.create({ data: { userId: me.id, spaceId } });
  revalidatePath('/knowledge');
  return { ok: true, data: { favorited: true } };
}
