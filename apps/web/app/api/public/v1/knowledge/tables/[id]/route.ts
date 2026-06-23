import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { apiOk, apiFail, apiUnauthorized, withApiErrors } from '@/lib/api/respond';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { getTable, getRelatedRowLabels } from '@/lib/knowledge/getTables';

/**
 * GET /api/public/v1/knowledge/tables/:id — a smart table's columns + rows.
 * RELATION cells include the resolved label alongside the stored target id.
 * Requires canView on the table's space.
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (req: Request, { params }: Ctx) => {
  const user = await resolveApiToken(req);
  if (!user) return apiUnauthorized();
  const { id } = await params;

  const table = await getTable(id);
  if (!table) return apiFail('not_found', 404);
  const access = await getSpaceAccessById(user, table.spaceId);
  if (!access.canView) return apiFail('not_found', 404);

  // Resolve RELATION target labels so consumers get human-readable references.
  const relationTableIds = table.columns
    .filter((c) => c.type === 'RELATION' && c.relationTableId)
    .map((c) => c.relationTableId as string);
  const relations = await getRelatedRowLabels(relationTableIds);

  return apiOk({
    table: {
      id: table.id,
      spaceId: table.spaceId,
      name: table.name,
      icon: table.icon,
      columns: table.columns.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        options: c.options,
        relationTableId: c.relationTableId,
        formulaExpr: c.formulaExpr,
      })),
      rows: table.rows.map((r) => ({ id: r.id, values: r.values })),
      relations,
    },
  });
});
