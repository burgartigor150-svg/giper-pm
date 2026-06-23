import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, withApiErrors } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';
import { createArticle } from '@/lib/knowledge/writeService';
import { normalizeKbMarkdown } from '@/lib/knowledge/markdownNormalize';

/**
 * POST /api/public/v1/knowledge/spaces/:id/articles — create an article in the
 * space. Body: { title?, parentId?, content?, status? }. Requires canEdit.
 * Content is normalized (table-embed un-escaping) like the editor save path.
 */
export const dynamic = 'force-dynamic';

const MAX_TITLE = 300;
const MAX_CONTENT = 1_000_000;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: Request, { params }: Ctx) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const rl = await rateLimit(`kb:write:${user.id}`, 60, 60);
  if (!rl.ok) return apiFail('rate_limited', 429, `Слишком много запросов, повторите через ~${rl.retryAfter}с`);
  const { id: spaceId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFail('validation', 400, 'Ожидается JSON-тело');
  }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.title !== undefined && typeof b.title !== 'string') {
    return apiFail('validation', 400, 'title должен быть строкой');
  }
  if (typeof b.title === 'string' && b.title.length > MAX_TITLE) {
    return apiFail('validation', 400, 'title слишком длинный (макс. 300)');
  }
  const title = typeof b.title === 'string' ? b.title : undefined;
  const parentId = typeof b.parentId === 'string' && b.parentId ? b.parentId : null;
  if (b.content !== undefined && typeof b.content !== 'string') {
    return apiFail('validation', 400, 'content должен быть строкой');
  }
  if (typeof b.content === 'string' && b.content.length > MAX_CONTENT) {
    return apiFail('validation', 400, 'content слишком длинный');
  }
  if (b.status !== undefined && b.status !== 'DRAFT' && b.status !== 'PUBLISHED') {
    return apiFail('validation', 400, 'status: DRAFT | PUBLISHED');
  }

  const data = await createArticle(user, {
    spaceId,
    parentId,
    title,
    content: typeof b.content === 'string' ? normalizeKbMarkdown(b.content) : undefined,
    // forward the validated status verbatim (DRAFT must NOT silently publish)
    status: b.status === 'DRAFT' || b.status === 'PUBLISHED' ? b.status : undefined,
  });
  return apiOk(data, 201);
});
