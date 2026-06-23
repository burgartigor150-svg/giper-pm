import { prisma } from '@giper/db';

export type KbColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'SELECT' | 'URL';

export type KbColumn = {
  id: string;
  name: string;
  type: KbColumnType;
  options: string[] | null;
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
    columns: t.columns.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as KbColumnType,
      options: Array.isArray(c.options) ? (c.options as string[]) : null,
      order: c.order,
    })),
    rows: t.rows.map((r) => ({
      id: r.id,
      order: r.order,
      values: (r.values && typeof r.values === 'object' && !Array.isArray(r.values)
        ? (r.values as Record<string, string>)
        : {}),
    })),
  };
}
