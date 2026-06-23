'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

type ColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'SELECT' | 'URL' | 'RELATION' | 'FORMULA';
const COLUMN_TYPES: ColumnType[] = ['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'URL', 'RELATION', 'FORMULA'];

/**
 * Per-type column config. `options` are SELECT values; `relationTableId` is the
 * RELATION target (must live in the same space); `formulaExpr` is the FORMULA
 * expression (`{Column} + {Other}`, see lib/knowledge/formula.ts). Stored in the
 * column's `options` Json: string[] for SELECT, {tableId} / {expr} for the rest.
 */
export type KbColumnConfig = { options?: string[]; relationTableId?: string; formulaExpr?: string };

const MAX_FORMULA = 500;
const validationErr = (message: string): ActionResult<never> => ({ ok: false, error: { code: 'VALIDATION', message } });

/**
 * Resolve & validate the `options` Json payload for a column type. Returns
 * `{ data }` to store (undefined = leave unset) or an `{ error }` ActionResult.
 */
async function resolveColumnOptions(
  type: ColumnType,
  config: KbColumnConfig | undefined,
  spaceId: string,
): Promise<{ data?: unknown } | { error: ActionResult<never> }> {
  if (type === 'SELECT') return { data: config?.options ?? [] };
  if (type === 'RELATION') {
    const target = config?.relationTableId;
    if (!target) return { error: validationErr('Выберите связанную таблицу') };
    const tt = await prisma.knowledgeTable.findUnique({ where: { id: target }, select: { spaceId: true } });
    if (!tt || tt.spaceId !== spaceId) return { error: validationErr('Связанная таблица недоступна') };
    return { data: { tableId: target } };
  }
  if (type === 'FORMULA') {
    const expr = (config?.formulaExpr ?? '').trim();
    if (!expr) return { error: validationErr('Введите формулу') };
    return { data: { expr: expr.slice(0, MAX_FORMULA) } };
  }
  return { data: undefined };
}

function deny(): ActionResult<never> {
  return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
}
function notFound(): ActionResult<never> {
  return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
}

// Smart-table edits require EDIT rights on the table's space (per-space access).
async function editGuard(
  me: { id: string; role: string },
  spaceId: string,
): Promise<ActionResult<never> | null> {
  const acc = await getSpaceAccessById(me, spaceId);
  if (!acc.exists) return notFound();
  return acc.canEdit ? null : deny();
}

const spaceIdOfTable = (tableId: string) =>
  prisma.knowledgeTable.findUnique({ where: { id: tableId }, select: { spaceId: true } });

async function spaceIdOfColumn(columnId: string): Promise<{ spaceId: string } | null> {
  const c = await prisma.knowledgeTableColumn.findUnique({
    where: { id: columnId },
    select: { table: { select: { spaceId: true } } },
  });
  return c ? { spaceId: c.table.spaceId } : null;
}

async function spaceIdOfRow(rowId: string): Promise<{ spaceId: string } | null> {
  const r = await prisma.knowledgeTableRow.findUnique({
    where: { id: rowId },
    select: { table: { select: { spaceId: true } } },
  });
  return r ? { spaceId: r.table.spaceId } : null;
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
  const guard = await editGuard(me, spaceId);
  if (guard) return guard;
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
  const t = await spaceIdOfTable(id);
  if (!t) return notFound();
  const guard = await editGuard(me, t.spaceId);
  if (guard) return guard;
  await prisma.knowledgeTable.update({ where: { id }, data: { name: name.trim() || 'Новая таблица' } });
  revalidatePath(`/knowledge/table/${id}`);
  return { ok: true };
}

export async function deleteTableAction(id: string): Promise<ActionResult<{ spaceId: string }>> {
  const me = await requireAuth();
  const t = await spaceIdOfTable(id);
  if (!t) return notFound();
  const guard = await editGuard(me, t.spaceId);
  if (guard) return guard;
  await prisma.knowledgeTable.delete({ where: { id } });
  revalidatePath('/knowledge');
  return { ok: true, data: { spaceId: t.spaceId } };
}

// ---- Columns --------------------------------------------------------------

export async function addColumnAction(
  tableId: string,
  name: string,
  type: ColumnType,
  config?: KbColumnConfig,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const t = await spaceIdOfTable(tableId);
  if (!t) return notFound();
  const guard = await editGuard(me, t.spaceId);
  if (guard) return guard;
  if (!COLUMN_TYPES.includes(type)) return validationErr('Неизвестный тип столбца');

  const opt = await resolveColumnOptions(type, config, t.spaceId);
  if ('error' in opt) return opt.error;

  const order = await nextOrder('column', tableId);
  const col = await prisma.knowledgeTableColumn.create({
    data: {
      tableId,
      name: name.trim() || 'Столбец',
      type,
      // Prisma's Json input accepts arrays/objects; undefined leaves it unset.
      options: opt.data as never,
      order,
    },
    select: { id: true },
  });
  revalidatePath(`/knowledge/table/${tableId}`);
  return { ok: true, data: { id: col.id } };
}

export async function updateColumnAction(
  id: string,
  patch: KbColumnConfig & { name?: string },
): Promise<ActionResult> {
  const me = await requireAuth();
  const col0 = await prisma.knowledgeTableColumn.findUnique({
    where: { id },
    select: { type: true, table: { select: { spaceId: true } } },
  });
  if (!col0) return notFound();
  const guard = await editGuard(me, col0.table.spaceId);
  if (guard) return guard;

  const data: { name?: string; options?: unknown } = {};
  if (patch.name !== undefined) data.name = patch.name.trim() || 'Столбец';

  // Type-aware config update: only the field relevant to the column's type is
  // applied, mirroring how addColumn stores `options`. RELATION re-targeting is
  // intentionally NOT supported — changing the target would orphan every stored
  // cell id against the new table; relation target is fixed at creation.
  const type = col0.type as ColumnType;
  const wantsConfig =
    (type === 'SELECT' && patch.options !== undefined) ||
    (type === 'FORMULA' && patch.formulaExpr !== undefined);
  if (wantsConfig) {
    const opt = await resolveColumnOptions(type, patch, col0.table.spaceId);
    if ('error' in opt) return opt.error;
    data.options = opt.data;
  }

  const col = await prisma.knowledgeTableColumn.update({
    where: { id },
    data: data as never,
    select: { tableId: true },
  });
  revalidatePath(`/knowledge/table/${col.tableId}`);
  return { ok: true };
}

export async function deleteColumnAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  const owner = await spaceIdOfColumn(id);
  if (!owner) return notFound();
  const guard = await editGuard(me, owner.spaceId);
  if (guard) return guard;
  const col = await prisma.knowledgeTableColumn.delete({ where: { id }, select: { tableId: true } });
  revalidatePath(`/knowledge/table/${col.tableId}`);
  return { ok: true };
}

// ---- Rows & cells ---------------------------------------------------------

export async function addRowAction(tableId: string): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const t = await spaceIdOfTable(tableId);
  if (!t) return notFound();
  const guard = await editGuard(me, t.spaceId);
  if (guard) return guard;
  const order = await nextOrder('row', tableId);
  const row = await prisma.knowledgeTableRow.create({ data: { tableId, order }, select: { id: true } });
  revalidatePath(`/knowledge/table/${tableId}`);
  return { ok: true, data: { id: row.id } };
}

export async function deleteRowAction(id: string): Promise<ActionResult> {
  const me = await requireAuth();
  const owner = await spaceIdOfRow(id);
  if (!owner) return notFound();
  const guard = await editGuard(me, owner.spaceId);
  if (guard) return guard;
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
  const row = await prisma.knowledgeTableRow.findUnique({
    where: { id: rowId },
    select: { tableId: true, table: { select: { spaceId: true } } },
  });
  if (!row) return notFound();
  const guard = await editGuard(me, row.table.spaceId);
  if (guard) return guard;

  // The column must belong to the SAME table (no writing under a foreign/stale id).
  const col = await prisma.knowledgeTableColumn.findUnique({
    where: { id: columnId },
    select: { tableId: true, type: true, options: true },
  });
  if (!col || col.tableId !== row.tableId) return notFound();
  // FORMULA cells are computed on read — they must never be persisted.
  if (col.type === 'FORMULA') return validationErr('Формульное поле вычисляется автоматически');
  // A RELATION value is a target-row id; verify it exists in the target table
  // (empty clears the cell). Guards against dangling ids from direct calls.
  if (col.type === 'RELATION' && value) {
    const opt = col.options && typeof col.options === 'object' && !Array.isArray(col.options)
      ? (col.options as Record<string, unknown>)
      : null;
    const targetId = opt && typeof opt.tableId === 'string' ? opt.tableId : null;
    const exists = targetId
      ? await prisma.knowledgeTableRow.count({ where: { id: value, tableId: targetId } })
      : 0;
    if (!exists) return validationErr('Связанная запись не найдена');
  }

  await prisma.$executeRaw`
    UPDATE "KnowledgeTableRow"
    SET "values" = jsonb_set(COALESCE("values", '{}'::jsonb), ARRAY[${columnId}]::text[], to_jsonb(${value}::text), true),
        "updatedAt" = now()
    WHERE "id" = ${rowId}`;
  return { ok: true };
}

/**
 * Create a row AND set its cells in one shot (used by the Form view). Atomic
 * create-with-values means a failed/abandoned submit never leaves a half-filled
 * orphan row. FORMULA values are dropped (computed); RELATION values are kept
 * only when they point at an existing row in the target table.
 */
export async function addRowWithValuesAction(
  tableId: string,
  values: Record<string, string>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const t = await spaceIdOfTable(tableId);
  if (!t) return notFound();
  const guard = await editGuard(me, t.spaceId);
  if (guard) return guard;

  const cols = await prisma.knowledgeTableColumn.findMany({
    where: { tableId },
    select: { id: true, type: true, options: true },
  });
  const byId = new Map(cols.map((c) => [c.id, c]));
  const clean: Record<string, string> = {};
  for (const [colId, raw] of Object.entries(values ?? {})) {
    const col = byId.get(colId);
    if (!col || col.type === 'FORMULA') continue;
    const v = String(raw ?? '');
    if (v === '') continue;
    if (col.type === 'RELATION') {
      const opt = col.options && typeof col.options === 'object' && !Array.isArray(col.options)
        ? (col.options as Record<string, unknown>)
        : null;
      const targetId = opt && typeof opt.tableId === 'string' ? opt.tableId : null;
      const exists = targetId
        ? await prisma.knowledgeTableRow.count({ where: { id: v, tableId: targetId } })
        : 0;
      if (!exists) continue; // skip dangling relation refs
    }
    clean[colId] = v;
  }

  const order = await nextOrder('row', tableId);
  const row = await prisma.knowledgeTableRow.create({
    data: { tableId, order, values: clean },
    select: { id: true },
  });
  revalidatePath(`/knowledge/table/${tableId}`);
  return { ok: true, data: { id: row.id } };
}
