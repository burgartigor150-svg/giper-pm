import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, apiFromError } from '@/lib/api/respond';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { getArticle } from '@/lib/knowledge/getKnowledge';
import { updateArticle, deleteArticle, setArticleStatus } from '@/lib/knowledge/writeService';
import { normalizeKbMarkdown } from '@/lib/knowledge/markdownNormalize';

/**
 * GET    /api/public/v1/knowledge/articles/:id — full article (markdown content).
 * PATCH  …/articles/:id — update { title?, content?, icon?, status? }.
 * DELETE …/articles/:id — delete the article.
 * GET requires canView; writes require canEdit (enforced in the service).
 */
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 1_000_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id } = await params;

  const article = await getArticle(id);
  if (!article) return apiFail('not_found', 404);
  const access = await getSpaceAccessById(user, article.spaceId);
  if (!access.canView) return apiFail('not_found', 404); // don't leak existence

  return apiOk({
    article: {
      id: article.id,
      spaceId: article.spaceId,
      title: article.title,
      content: article.content,
      icon: article.icon,
      status: article.status,
      parentId: article.parentId,
      updatedAt: article.updatedAt,
    },
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFail('validation', 400, 'Ожидается JSON-тело');
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const patch: { title?: string; content?: string; icon?: string | null } = {};
  if (b.title !== undefined) {
    if (typeof b.title !== 'string') return apiFail('validation', 400, 'title должен быть строкой');
    patch.title = b.title.slice(0, 300);
  }
  if (b.content !== undefined) {
    if (typeof b.content !== 'string') return apiFail('validation', 400, 'content должен быть строкой');
    if (b.content.length > MAX_CONTENT) return apiFail('validation', 400, 'content слишком длинный');
    patch.content = normalizeKbMarkdown(b.content);
  }
  if (b.icon !== undefined) {
    if (b.icon !== null && typeof b.icon !== 'string') return apiFail('validation', 400, 'icon: строка или null');
    patch.icon = b.icon as string | null;
  }
  if (b.status !== undefined && b.status !== 'DRAFT' && b.status !== 'PUBLISHED') {
    return apiFail('validation', 400, 'status: DRAFT | PUBLISHED');
  }

  try {
    if (Object.keys(patch).length > 0) await updateArticle(user, id, patch);
    if (b.status === 'DRAFT' || b.status === 'PUBLISHED') await setArticleStatus(user, id, b.status);
    return apiOk({ id });
  } catch (e) {
    return apiFromError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id } = await params;
  try {
    await deleteArticle(user, id);
    return apiOk({ id });
  } catch (e) {
    return apiFromError(e);
  }
}
