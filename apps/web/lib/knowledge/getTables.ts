import { prisma } from '@giper/db';

export type KbColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'SELECT' | 'URL' | 'RELATION' | 'FORMULA';

export type KbColumn = {
  id: string;
  name: string;
  type: KbColumnType;
  options: string[] | null; // SELECT values
  relationTableId: string | null; // RELATION target table
  formulaExpr: string | null; // FORMULA expression
  order: number;
};

export type KbRow = {
  id: string;
  order: number;
  values: Record<string, string>;
};

/** Tables in a space (for the space page list). */
export async function listSpaceTables(spaceId: string) {
  return prisma.knowledgeTable.findMany({
    where: { spaceId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      icon: true,
      _count: { select: { columns: true, rows: true } },
    },
  });
}

/** A full table with ordered columns + rows for the grid view. */
export async function getTable(id: string): Promise<
  | {
      id: string;
      spaceId: string;
      name: string;
      icon: string | null;
      space: { id: string; name: string; icon: string | null };
      columns: KbColumn[];
      rows: KbRow[];
    }
  | null
> {
  const t = await prisma.knowledgeTable.findUnique({
    where: { id },
    select: {
      id: true,
      spaceId: true,
      name: true,
      icon: true,
      space: { select: { id: true, name: true, icon: true } },
      columns: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, type: true, options: true, order: true },
      },
      rows: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, order: true, values: true },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    spaceId: t.spaceId,
    name: t.name,
    icon: t.icon,
    space: t.space,
    columns: t.columns.map((c) => {
      const opt = c.options && typeof c.options === 'object' && !Array.isArray(c.options)
        ? (c.options as Record<string, unknown>)
        : null;
      return {
        id: c.id,
        name: c.name,
        type: c.type as KbColumnType,
        options: Array.isArray(c.options) ? (c.options as string[]) : null,
        relationTableId: opt && typeof opt.tableId === 'string' ? opt.tableId : null,
        formulaExpr: opt && typeof opt.expr === 'string' ? opt.expr : null,
        order: c.order,
      };
    }),
    rows: t.rows.map((r) => ({
      id: r.id,
      order: r.order,
      values: (r.values && typeof r.values === 'object' && !Array.isArray(r.values)
        ? (r.values as Record<string, string>)
        : {}),
    })),
  };
}

export type KbRelationOption = { id: string; label: string };

/**
 * For RELATION columns: map each referenced table → its rows as {id,label}
 * (label = the row's first-column value). Used to render relation cells + the
 * picker. Returns {} if no relations.
 */
export async function getRelatedRowLabels(
  tableIds: string[],
): Promise<Record<string, KbRelationOption[]>> {
  const unique = [...new Set(tableIds)].filter(Boolean);
  if (unique.length === 0) return {};
  const tables = await prisma.knowledgeTable.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      columns: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], take: 1, select: { id: true } },
      rows: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true, values: true } },
    },
  });
  const out: Record<string, KbRelationOption[]> = {};
  for (const t of tables) {
    const labelCol = t.columns[0]?.id;
    out[t.id] = t.rows.map((r) => {
      const vals = r.values && typeof r.values === 'object' && !Array.isArray(r.values)
        ? (r.values as Record<string, string>)
        : {};
      const label = (labelCol && vals[labelCol]) || 'Без названия';
      return { id: r.id, label };
    });
  }
  return out;
}

