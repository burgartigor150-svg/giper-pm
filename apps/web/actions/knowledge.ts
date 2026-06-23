'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

// Creating brand-new spaces + managing templates stays a global ADMIN/PM action.
// Read / edit / per-space management are resolved per space (see lib/knowledge/access).
const canManageSpaces = (role: string) => role === 'ADMIN' || role === 'PM';

const DENY: ActionResult<never> = {
  ok: false,
  error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
};
const NOT_FOUND: ActionResult<never> = {
  ok: false,
  error: { code: 'NOT_FOUND', message: 'Пространство не найдено' },
};

/** Returns a deny/not-found ActionResult if the user can't EDIT content in the space, else null. */
async function spaceEditGuard(
  me: { id: string; role: string },
  spaceId: string,
): Promise<ActionResult<never> | null> {
  const acc = await getSpaceAccessById(me, spaceId);
  if (!acc.exists) return NOT_FOUND;
  return acc.canEdit ? null : DENY;
}

/** Returns a deny/not-found ActionResult if the user can't MANAGE the space, else null. */
async function spaceManageGuard(
  me: { id: string; role: string },
  spaceId: string,
): Promise<ActionResult<never> | null> {
  const acc = await getSpaceAccessById(me, spaceId);
  if (!acc.exists) return NOT_FOUND;
  return acc.canManage ? null : DENY;
}

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
  const guard = await spaceManageGuard(me, id);
  if (guard) return guard;
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
  const guard = await spaceManageGuard(me, id);
  if (guard) return guard;
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
  const guard = await spaceEditGuard(me, spaceId);
  if (guard) return guard;
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
  const article = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { spaceId: true } });
  if (!article) return { ok: false, error: { code: 'NOT_FOUND', message: 'Статья не найдена' } };
  const guard = await spaceEditGuard(me, article.spaceId);
  if (guard) return guard;
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
  const article = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { spaceId: true } });
  if (!article) return { ok: false, error: { code: 'NOT_FOUND', message: 'Статья не найдена' } };
  const guard = await spaceEditGuard(me, article.spaceId);
  if (guard) return guard;
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
  const article = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { spaceId: true } });
  if (!article) return { ok: false, error: { code: 'NOT_FOUND', message: 'Статья не найдена' } };
  const guard = await spaceEditGuard(me, article.spaceId);
  if (guard) return guard;
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
  const article = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { spaceId: true } });
  if (!article) return { ok: false, error: { code: 'NOT_FOUND', message: 'Статья не найдена' } };
  const guard = await spaceEditGuard(me, article.spaceId);
  if (guard) return guard;
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
  // Atomic toggle: deleteMany reports how many rows it removed, so we avoid the
  // find-then-create race (concurrent toggles from two tabs would otherwise hit
  // the userId_articleId unique → P2002). Creating is guarded for the same race.
  const removed = await prisma.knowledgeFavorite.deleteMany({
    where: { userId: me.id, articleId },
  });
  if (removed.count > 0) {
    revalidatePath('/knowledge');
    return { ok: true, data: { favorited: false } };
  }
  try {
    await prisma.knowledgeFavorite.create({ data: { userId: me.id, articleId } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    // Already favorited by a concurrent request — idempotent success.
  }
  revalidatePath('/knowledge');
  return { ok: true, data: { favorited: true } };
}

export async function toggleFavoriteSpaceAction(
  spaceId: string,
): Promise<ActionResult<{ favorited: boolean }>> {
  const me = await requireAuth();
  const removed = await prisma.knowledgeFavorite.deleteMany({
    where: { userId: me.id, spaceId },
  });
  if (removed.count > 0) {
    revalidatePath('/knowledge');
    return { ok: true, data: { favorited: false } };
  }
  try {
    await prisma.knowledgeFavorite.create({ data: { userId: me.id, spaceId } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
  revalidatePath('/knowledge');
  return { ok: true, data: { favorited: true } };
}

// ---- Templates ------------------------------------------------------------
// Templates are structural → ADMIN/PM manage; creating an article from one only
// needs article-edit rights.

type TemplateScope = 'ACCOUNT' | 'SPACE';

export async function createTemplateAction(input: {
  name: string;
  scope: TemplateScope;
  spaceId?: string | null;
  content?: string;
  description?: string | null;
  icon?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  const scope: TemplateScope = input.scope === 'SPACE' ? 'SPACE' : 'ACCOUNT';
  const spaceId = scope === 'SPACE' ? (input.spaceId ?? null) : null;
  if (scope === 'SPACE' && !spaceId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Для шаблона пространства укажите пространство' } };
  }
  if (spaceId) {
    const space = await prisma.knowledgeSpace.findUnique({ where: { id: spaceId }, select: { id: true } });
    if (!space) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пространство не найдено' } };
  }
  const max = await prisma.knowledgeTemplate.aggregate({ where: { scope, spaceId }, _max: { order: true } });
  const tpl = await prisma.knowledgeTemplate.create({
    data: {
      name: input.name.trim() || 'Новый шаблон',
      scope,
      spaceId,
      content: input.content ?? '',
      description: input.description ?? null,
      icon: input.icon ?? null,
      order: (max._max.order ?? -1) + 1,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/knowledge/templates');
  return { ok: true, data: { id: tpl.id } };
}

export async function updateTemplateAction(
  id: string,
  patch: { name?: string; content?: string; description?: string | null; icon?: string | null },
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  await prisma.knowledgeTemplate.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Новый шаблон' } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    },
  });
  revalidatePath('/knowledge/templates');
  return { ok: true };
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canManageSpaces(me.role)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN/PM' } };
  }
  await prisma.knowledgeTemplate.delete({ where: { id } });
  revalidatePath('/knowledge/templates');
  return { ok: true };
}

/** Create a new article in a space, pre-filled from a template. */
export async function createArticleFromTemplateAction(
  spaceId: string,
  parentId: string | null,
  templateId: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const guard = await spaceEditGuard(me, spaceId);
  if (guard) return guard;
  const tpl = await prisma.knowledgeTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, content: true, icon: true, scope: true, spaceId: true },
  });
  if (!tpl) return { ok: false, error: { code: 'NOT_FOUND', message: 'Шаблон не найден' } };
  // A space-scoped template can only be used inside its own space.
  if (tpl.scope === 'SPACE' && tpl.spaceId !== spaceId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Шаблон принадлежит другому пространству' } };
  }
  const order = await nextOrder({ spaceId, parentId: parentId ?? null });
  const article = await prisma.knowledgeArticle.create({
    data: {
      spaceId,
      parentId: parentId ?? null,
      title: tpl.name.trim() || 'Без названия',
      content: tpl.content,
      icon: tpl.icon,
      order,
      createdById: me.id,
      updatedById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/knowledge');
  return { ok: true, data: { id: article.id } };
}

// ---- Space access (visibility + members) ----------------------------------
// All require MANAGE on the space (global ADMIN/PM, or a MANAGER member).

export async function setSpaceVisibilityAction(
  spaceId: string,
  visibility: 'PUBLIC' | 'PRIVATE',
): Promise<ActionResult> {
  const me = await requireAuth();
  const guard = await spaceManageGuard(me, spaceId);
  if (guard) return guard;
  if (visibility !== 'PUBLIC' && visibility !== 'PRIVATE') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверная видимость' } };
  }
  await prisma.knowledgeSpace.update({ where: { id: spaceId }, data: { visibility } });
  revalidatePath('/knowledge');
  revalidatePath(`/knowledge/space/${spaceId}`);
  return { ok: true };
}

export async function addSpaceMemberAction(
  spaceId: string,
  userId: string,
  role: 'EDITOR' | 'MANAGER' = 'EDITOR',
): Promise<ActionResult> {
  const me = await requireAuth();
  const guard = await spaceManageGuard(me, spaceId);
  if (guard) return guard;
  const safeRole = role === 'MANAGER' ? 'MANAGER' : 'EDITOR';
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пользователь не найден' } };
  // Idempotent: re-adding updates the role instead of throwing on the unique key.
  await prisma.knowledgeSpaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    update: { role: safeRole },
    create: { spaceId, userId, role: safeRole },
  });
  revalidatePath(`/knowledge/space/${spaceId}`);
  revalidatePath('/knowledge');
  return { ok: true };
}

export async function updateSpaceMemberRoleAction(
  spaceId: string,
  userId: string,
  role: 'EDITOR' | 'MANAGER',
): Promise<ActionResult> {
  const me = await requireAuth();
  const guard = await spaceManageGuard(me, spaceId);
  if (guard) return guard;
  const safeRole = role === 'MANAGER' ? 'MANAGER' : 'EDITOR';
  await prisma.knowledgeSpaceMember.updateMany({ where: { spaceId, userId }, data: { role: safeRole } });
  revalidatePath(`/knowledge/space/${spaceId}`);
  return { ok: true };
}

export async function removeSpaceMemberAction(
  spaceId: string,
  userId: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const guard = await spaceManageGuard(me, spaceId);
  if (guard) return guard;
  await prisma.knowledgeSpaceMember.deleteMany({ where: { spaceId, userId } });
  revalidatePath(`/knowledge/space/${spaceId}`);
  revalidatePath('/knowledge');
  return { ok: true };
}
