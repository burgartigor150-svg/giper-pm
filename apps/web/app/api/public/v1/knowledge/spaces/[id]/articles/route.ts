import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, apiFromError } from '@/lib/api/respond';
import { createArticle } from '@/lib/knowledge/writeService';
import { normalizeKbMarkdown } from '@/lib/knowledge/markdownNormalize';

/**
 * POST /api/public/v1/knowledge/spaces/:id/articles — create an article in the
 * space. Body: { title?, parentId?, content?, status? }. Requires canEdit.
 * Content is normalized (table-embed un-escaping) like the editor save path.
 */
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 1_000_000;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id: spaceId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFail('validation', 400, 'Ожидается JSON-тело');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.slice(0, 300) : undefined;
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

  try {
    const { id } = await createArticle(user, {
      spaceId,
      parentId,
      title,
      content: typeof b.content === 'string' ? normalizeKbMarkdown(b.content) : undefined,
      status: b.status === 'PUBLISHED' ? 'PUBLISHED' : undefined,
    });
    return apiOk({ id }, 201);
  } catch (e) {
    return apiFromError(e);
  }
}
