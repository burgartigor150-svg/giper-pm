import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, withApiErrors } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';
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

const MAX_TITLE = 300;
const MAX_CONTENT = 1_000_000;

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (req: Request, { params }: Ctx) => {
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
});

export const PATCH = withApiErrors(async (req: Request, { params }: Ctx) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const rl = await rateLimit(`kb:write:${user.id}`, 60, 60);
  if (!rl.ok) return apiFail('rate_limited', 429, `Слишком много запросов, повторите через ~${rl.retryAfter}с`);
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
    if (b.title.length > MAX_TITLE) return apiFail('validation', 400, 'title слишком длинный (макс. 300)');
    patch.title = b.title;
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

  if (Object.keys(patch).length > 0) await updateArticle(user, id, patch);
  if (b.status === 'DRAFT' || b.status === 'PUBLISHED') await setArticleStatus(user, id, b.status);
  return apiOk({ id });
});

export const DELETE = withApiErrors(async (req: Request, { params }: Ctx) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const rl = await rateLimit(`kb:write:${user.id}`, 60, 60);
  if (!rl.ok) return apiFail('rate_limited', 429, `Слишком много запросов, повторите через ~${rl.retryAfter}с`);
  const { id } = await params;
  await deleteArticle(user, id);
  return apiOk({ id });
});
