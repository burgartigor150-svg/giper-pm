import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiUnauthorized } from '@/lib/api/respond';
import { searchKnowledge } from '@/lib/knowledge/getKnowledge';

/**
 * GET /api/public/v1/knowledge/search?q=… — published articles in viewable
 * spaces matching the query (title/body). Scoped to the token owner's access.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const results = await searchKnowledge(q, user);
  return apiOk({
    query: q,
    results: results.map((a) => ({
      id: a.id,
      title: a.title,
      icon: a.icon,
      space: { id: a.space.id, name: a.space.name },
    })),
  });
}
