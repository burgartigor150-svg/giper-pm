import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, withApiErrors } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';
import { listKnowledgeSpaces } from '@/lib/knowledge/getKnowledge';
import { createSpace } from '@/lib/knowledge/writeService';

/**
 * GET  /api/public/v1/knowledge/spaces — spaces the token owner may view.
 * POST /api/public/v1/knowledge/spaces — create a space (ADMIN/PM only).
 * Auth: Authorization: Bearer gpm_… (see ApiToken). Token owner's own access.
 */
export const dynamic = 'force-dynamic';

const MAX_NAME = 300;

export const GET = withApiErrors(async (req: Request) => {
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
});

export const POST = withApiErrors(async (req: Request) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const rl = await rateLimit(`kb:write:${user.id}`, 60, 60);
  if (!rl.ok) return apiFail('rate_limited', 429, `Слишком много запросов, повторите через ~${rl.retryAfter}с`);

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
  if (b.name.length > MAX_NAME) return apiFail('validation', 400, 'name слишком длинный (макс. 300)');
  const icon = typeof b.icon === 'string' ? b.icon : undefined;
  const data = await createSpace(user, { name: b.name, icon });
  return apiOk(data, 201);
});
