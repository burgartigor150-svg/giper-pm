'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

type ColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'SELECT' | 'URL';
const COLUMN_TYPES: ColumnType[] = ['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'URL'];

// Smart tables are editable content → any non-VIEWER, like articles.
const canEdit = (role: string) => role !== 'VIEWER';

function deny(): ActionResult<never> {
  return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
}

async function nextOrder(model: 'column' | 'row', tableId: string): Promise<number> {
  const agg =
    model === 'column'
      ? await prisma.knowledgeTableColumn.aggregate({ where: { tableId }, _max: { order: true } })
      : await prisma.knowledgeTableRow.aggregate({ where: { tableId }, _max: { order: true } });
  return (agg._max.order ?? -1) + 1;
}

// ---- Table ----------------------------------------------------------------

export async function createTableAction(
  spaceId: string,
  name?: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const space = await prisma.knowledgeSpace.findUnique({ where: { id: spaceId }, select: { id: true } });
  if (!space) return { ok: false, error: { code: 'NOT_FOUND', message: 'Пространство не найдено' } };
  const max = await prisma.knowledgeTable.aggregate({ where: { spaceId }, _max: { order: true } });
  const table = await prisma.knowledgeTable.create({
    data: {
      spaceId,
      name: name?.trim() || 'Новая таблица',
      order: (max._max.order ?? -1) + 1,
      createdById: me.id,
      columns: { create: [{ name: 'Название', type: 'TEXT', order: 0 }] },
      rows: { create: [{ order: 0 }] },
    },
    select: { id: true },
  });
  revalidatePath('/knowledge');
  return { ok: true, data: { id: table.id } };
}

export async function renameTableAction(id: string, name: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  await prisma.knowledgeTable.update({ where: { id }, data: { name: name.trim() || 'Новая таблица' } });
  revalidatePath(`/knowledge/table/${id}`);
  return { ok: true };
}

export async function deleteTableAction(id: string): Promise<ActionResult<{ spaceId: string }>> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const t = await prisma.knowledgeTable.findUnique({ where: { id }, select: { spaceId: true } });
  if (!t) return { ok: false, error: { code: 'NOT_FOUND', message: 'Таблица не найдена' } };
  await prisma.knowledgeTable.delete({ where: { id } });
  revalidatePath('/knowledge');
  return { ok: true, data: { spaceId: t.spaceId } };
}

// ---- Columns --------------------------------------------------------------

export async function addColumnAction(
  tableId: string,
  name: string,
  type: ColumnType,
  options?: string[],
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  if (!COLUMN_TYPES.includes(type)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неизвестный тип столбца' } };
  }
  const order = await nextOrder('column', tableId);
  const col = await prisma.knowledgeTableColumn.create({
    data: {
      tableId,
      name: name.trim() || 'Столбец',
      type,
      options: type === 'SELECT' ? (options ?? []) : undefined,
      order,
    },
    select: { id: true },
  });
  revalidatePath(`/knowledge/table/${tableId}`);
  return { ok: true, data: { id: col.id } };
}

export async function updateColumnAction(
  id: string,
  patch: { name?: string; options?: string[] },
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const col = await prisma.knowledgeTableColumn.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Столбец' } : {}),
      ...(patch.options !== undefined ? { options: patch.options } : {}),
    },
    select: { tableId: true },
  });
  revalidatePath(`/knowledge/table/${col.tableId}`);
  return { ok: true };
}

export async function deleteColumnAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const col = await prisma.knowledgeTableColumn.delete({ where: { id }, select: { tableId: true } });
  revalidatePath(`/knowledge/table/${col.tableId}`);
  return { ok: true };
}

// ---- Rows & cells ---------------------------------------------------------

export async function addRowAction(tableId: string): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const order = await nextOrder('row', tableId);
  const row = await prisma.knowledgeTableRow.create({ data: { tableId, order }, select: { id: true } });
  revalidatePath(`/knowledge/table/${tableId}`);
  return { ok: true, data: { id: row.id } };
}

export async function deleteRowAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  const row = await prisma.knowledgeTableRow.delete({ where: { id }, select: { tableId: true } });
  revalidatePath(`/knowledge/table/${row.tableId}`);
  return { ok: true };
}

/**
 * Set one cell atomically. jsonb_set on a single key avoids the read-modify-write
 * race that would clobber concurrent edits to other cells in the same row.
 */
export async function updateCellAction(
  rowId: string,
  columnId: string,
  value: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEdit(me.role)) return deny();
  await prisma.$executeRaw`
    UPDATE "KnowledgeTableRow"
    SET "values" = jsonb_set(COALESCE("values", '{}'::jsonb), ARRAY[${columnId}]::text[], to_jsonb(${value}::text), true),
        "updatedAt" = now()
    WHERE "id" = ${rowId}`;
  return { ok: true };
}
