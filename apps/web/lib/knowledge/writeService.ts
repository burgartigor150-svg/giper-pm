import { prisma } from '@giper/db';
import { DomainError } from '@/lib/errors';
import { getSpaceAccessById, isGlobalKbManager, type KbSessionUser } from './access';

/**
 * Knowledge Base write operations as plain services that take an explicit acting
 * user and throw DomainError. Both the server actions (UI) and the public REST
 * API call these, so permission + mutation logic lives in exactly one place
 * (mirrors the lib/tasks service layer). No revalidatePath here — callers that
 * need Next cache invalidation do it themselves.
 */

// Icon is a short string (emoji / few chars) — cap it so the API can't store
// an oversized value that bypasses the title/content caps.
const MAX_ICON = 64;

function capIcon(icon: string | null | undefined): string | null | undefined {
  if (typeof icon !== 'string') return icon;
  return icon.slice(0, MAX_ICON);
}

async function assertEdit(user: KbSessionUser, spaceId: string): Promise<void> {
  const acc = await getSpaceAccessById(user, spaceId);
  if (!acc.exists) throw new DomainError('NOT_FOUND', 404, 'Пространство не найдено');
  if (!acc.canEdit) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Недостаточно прав');
}

async function nextArticleOrder(spaceId: string, parentId: string | null): Promise<number> {
  const max = await prisma.knowledgeArticle.aggregate({
    where: { spaceId, parentId },
    _max: { order: true },
  });
  return (max._max.order ?? -1) + 1;
}

// ---- Spaces ---------------------------------------------------------------

export async function createSpace(
  user: KbSessionUser,
  input: { name: string; icon?: string | null },
): Promise<{ id: string }> {
  if (!isGlobalKbManager(user.role)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Только ADMIN/PM');
  }
  const name = (input.name ?? '').trim() || 'Новое пространство';
  const max = await prisma.knowledgeSpace.aggregate({ _max: { order: true } });
  const space = await prisma.knowledgeSpace.create({
    data: {
      name,
      icon: input.icon?.trim().slice(0, MAX_ICON) || null,
      order: (max._max.order ?? -1) + 1,
      createdById: user.id,
    },
    select: { id: true },
  });
  return { id: space.id };
}

// ---- Articles -------------------------------------------------------------

export async function createArticle(
  user: KbSessionUser,
  input: {
    spaceId: string;
    parentId?: string | null;
    title?: string;
    content?: string;
    status?: 'DRAFT' | 'PUBLISHED';
  },
): Promise<{ id: string }> {
  await assertEdit(user, input.spaceId);
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await prisma.knowledgeArticle.findUnique({
      where: { id: parentId },
      select: { spaceId: true },
    });
    if (!parent || parent.spaceId !== input.spaceId) {
      throw new DomainError('VALIDATION', 400, 'Родительская статья не найдена в этом пространстве');
    }
  }
  const order = await nextArticleOrder(input.spaceId, parentId);
  // Initial content/status are written at creation — no version snapshot (the
  // article had no prior state to preserve).
  const article = await prisma.knowledgeArticle.create({
    data: {
      spaceId: input.spaceId,
      parentId,
      title: input.title?.trim() || 'Без названия',
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.status ? { status: input.status } : {}),
      order,
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  });
  return { id: article.id };
}

export async function updateArticle(
  user: KbSessionUser,
  id: string,
  patch: { title?: string; content?: string; icon?: string | null },
): Promise<void> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    select: { spaceId: true, title: true, content: true, icon: true },
  });
  if (!article) throw new DomainError('NOT_FOUND', 404, 'Статья не найдена');
  await assertEdit(user, article.spaceId);

  // Snapshot the PRIOR state into history when the body or title actually
  // changes (icon-only / no-op saves don't spawn versions).
  const titleChanges = patch.title !== undefined && patch.title.trim() !== article.title;
  const contentChanges = patch.content !== undefined && patch.content !== article.content;
  if (titleChanges || contentChanges) {
    await prisma.knowledgeArticleVersion.create({
      data: {
        articleId: id,
        title: article.title,
        content: article.content,
        icon: article.icon,
        editedById: user.id,
      },
    });
  }
  await prisma.knowledgeArticle.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || 'Без названия' } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.icon !== undefined ? { icon: capIcon(patch.icon) ?? null } : {}),
      updatedById: user.id,
    },
  });
}

export async function deleteArticle(user: KbSessionUser, id: string): Promise<void> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    select: { spaceId: true },
  });
  if (!article) throw new DomainError('NOT_FOUND', 404, 'Статья не найдена');
  await assertEdit(user, article.spaceId);
  await prisma.knowledgeArticle.delete({ where: { id } });
}

export async function setArticleStatus(
  user: KbSessionUser,
  id: string,
  status: 'DRAFT' | 'PUBLISHED',
): Promise<void> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    select: { spaceId: true },
  });
  if (!article) throw new DomainError('NOT_FOUND', 404, 'Статья не найдена');
  await assertEdit(user, article.spaceId);
  await prisma.knowledgeArticle.update({ where: { id }, data: { status, updatedById: user.id } });
}
