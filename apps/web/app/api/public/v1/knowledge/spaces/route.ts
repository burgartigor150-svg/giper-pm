import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, apiFromError } from '@/lib/api/respond';
import { listKnowledgeSpaces } from '@/lib/knowledge/getKnowledge';
import { createSpace } from '@/lib/knowledge/writeService';

/**
 * GET  /api/public/v1/knowledge/spaces — spaces the token owner may view.
 * POST /api/public/v1/knowledge/spaces — create a space (ADMIN/PM only).
 * Auth: Authorization: Bearer gpm_… (see ApiToken). Token owner's own access.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const spaces = await listKnowledgeSpaces(user);
  return apiOk({
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      color: s.color,
      description: s.description,
      visibility: s.visibility,
      articleCount: s._count.articles,
    })),
  });
}

export async function POST(req: Request) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFail('validation', 400, 'Ожидается JSON-тело');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return apiFail('validation', 400, 'Поле name обязательно');
  }
  const icon = typeof b.icon === 'string' ? b.icon : undefined;
  try {
    const data = await createSpace(user, { name: b.name.slice(0, 300), icon });
    return apiOk(data, 201);
  } catch (e) {
    return apiFromError(e);
  }
}
