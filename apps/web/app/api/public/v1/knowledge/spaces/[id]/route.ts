import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, withApiErrors } from '@/lib/api/respond';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { getSpace, getSpaceArticles } from '@/lib/knowledge/getKnowledge';
import { listSpaceTables } from '@/lib/knowledge/getTables';

/**
 * GET /api/public/v1/knowledge/spaces/:id — one space with its article tree
 * (id/title/parent/order/status) and its smart tables. Requires canView.
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (req: Request, { params }: Ctx) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id } = await params;

  const access = await getSpaceAccessById(user, id);
  if (!access.exists) return apiFail('not_found', 404);
  if (!access.canView) return apiFail('insufficient_permissions', 403);

  const [space, articles, tables] = await Promise.all([
    getSpace(id),
    getSpaceArticles(id),
    listSpaceTables(id),
  ]);
  if (!space) return apiFail('not_found', 404);

  return apiOk({
    space: {
      id: space.id,
      name: space.name,
      icon: space.icon,
      color: space.color,
      description: space.description,
      visibility: space.visibility,
      articleCount: space._count.articles,
    },
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      icon: a.icon,
      parentId: a.parentId,
      order: a.order,
      status: a.status,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      columnCount: t._count.columns,
      rowCount: t._count.rows,
    })),
    access: { canEdit: access.canEdit, canManage: access.canManage },
  });
});
