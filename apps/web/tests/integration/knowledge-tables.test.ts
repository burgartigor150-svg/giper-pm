import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for Knowledge Base smart tables (slice D): table/column/row
 * CRUD, atomic cell updates (jsonb_set must not clobber sibling cells), and the
 * non-VIEWER edit gate.
 *
 * Source: apps/web/actions/knowledgeTables.ts, lib/knowledge/getTables.ts
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import { createSpaceAction } from '@/actions/knowledge';
import {
  createTableAction,
  addColumnAction,
  addRowAction,
  addRowWithValuesAction,
  updateCellAction,
  deleteColumnAction,
  deleteRowAction,
  deleteTableAction,
} from '@/actions/knowledgeTables';
import { getTable } from '@/lib/knowledge/getTables';
import { makeUser } from './helpers/factories';

async function asUser(role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER') {
  const u = await makeUser({ role });
  mockMe.id = u.id;
  mockMe.role = role;
  return u;
}

async function freshSpace() {
  mockMe.role = 'ADMIN';
  const sp = await createSpaceAction('Таблицы-тест');
  return sp.ok ? sp.data!.id : '';
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('knowledge tables — structure', () => {
  it('creates a table with a default column and an empty row', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId, 'Реестр');
    expect(t.ok).toBe(true);
    const table = await getTable(t.ok ? t.data!.id : '');
    expect(table?.name).toBe('Реестр');
    expect(table?.columns.length).toBe(1);
    expect(table?.columns[0]?.type).toBe('TEXT');
    expect(table?.rows.length).toBe(1);
  });

  it('adds typed columns and rows', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    await addColumnAction(tableId, 'Готово', 'CHECKBOX');
    await addColumnAction(tableId, 'Статус', 'SELECT', { options: ['Новый', 'В работе'] });
    await addRowAction(tableId);

    const table = await getTable(tableId);
    expect(table?.columns.map((c) => c.type)).toEqual(['TEXT', 'CHECKBOX', 'SELECT']);
    const sel = table?.columns.find((c) => c.type === 'SELECT');
    expect(sel?.options).toEqual(['Новый', 'В работе']);
    expect(table?.rows.length).toBe(2); // default row + added
  });
});

describe('knowledge tables — relation & formula columns', () => {
  it('adds a RELATION column only to a table in the same space and exposes its target', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const target = await createTableAction(spaceId, 'Клиенты');
    const targetId = target.ok ? target.data!.id : '';
    const main = await createTableAction(spaceId, 'Заказы');
    const mainId = main.ok ? main.data!.id : '';

    // missing target → validation error
    expect((await addColumnAction(mainId, 'Клиент', 'RELATION')).ok).toBe(false);

    // a table from ANOTHER space cannot be a target
    mockMe.role = 'ADMIN';
    const other = await createSpaceAction('Чужое');
    const otherTable = await createTableAction(other.ok ? other.data!.id : '', 'Чужая');
    const bad = await addColumnAction(mainId, 'Клиент', 'RELATION', {
      relationTableId: otherTable.ok ? otherTable.data!.id : '',
    });
    expect(bad.ok).toBe(false);

    const ok = await addColumnAction(mainId, 'Клиент', 'RELATION', { relationTableId: targetId });
    expect(ok.ok).toBe(true);
    const table = await getTable(mainId);
    const relCol = table?.columns.find((c) => c.type === 'RELATION');
    expect(relCol?.relationTableId).toBe(targetId);
  });

  it('adds a FORMULA column and round-trips its expression', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    await addColumnAction(tableId, 'Цена', 'NUMBER');
    await addColumnAction(tableId, 'Кол-во', 'NUMBER');
    expect((await addColumnAction(tableId, 'Сумма', 'FORMULA')).ok).toBe(false); // empty expr
    const ok = await addColumnAction(tableId, 'Сумма', 'FORMULA', { formulaExpr: '{Цена} * {Кол-во}' });
    expect(ok.ok).toBe(true);
    const table = await getTable(tableId);
    expect(table?.columns.find((c) => c.type === 'FORMULA')?.formulaExpr).toBe('{Цена} * {Кол-во}');
  });
});

describe('knowledge tables — cell validation (relation/formula)', () => {
  it('rejects writing to a FORMULA cell and validates RELATION ids', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const target = await createTableAction(spaceId, 'Клиенты');
    const targetId = target.ok ? target.data!.id : '';
    const targetTable = await getTable(targetId);
    const targetRowId = targetTable!.rows[0]!.id;

    const main = await createTableAction(spaceId, 'Заказы');
    const mainId = main.ok ? main.data!.id : '';
    const fCol = await addColumnAction(mainId, 'Сумма', 'FORMULA', { formulaExpr: '1 + 1' });
    const rCol = await addColumnAction(mainId, 'Клиент', 'RELATION', { relationTableId: targetId });
    const mainTable = await getTable(mainId);
    const rowId = mainTable!.rows[0]!.id;

    // FORMULA cell is computed — cannot be written
    expect((await updateCellAction(rowId, fCol.ok ? fCol.data!.id : '', '5')).ok).toBe(false);
    // RELATION rejects a non-existent target id, accepts a real one
    expect((await updateCellAction(rowId, rCol.ok ? rCol.data!.id : '', 'nope')).ok).toBe(false);
    expect((await updateCellAction(rowId, rCol.ok ? rCol.data!.id : '', targetRowId)).ok).toBe(true);
  });

  it('addRowWithValuesAction creates a row atomically, dropping formula/invalid-relation values', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    const before = (await getTable(tableId))!.columns[0]!.id; // 'Название' TEXT
    const num = await addColumnAction(tableId, 'Цена', 'NUMBER');
    const f = await addColumnAction(tableId, 'Двойная', 'FORMULA', { formulaExpr: '{Цена} * 2' });

    const res = await addRowWithValuesAction(tableId, {
      [before]: 'Товар',
      [num.ok ? num.data!.id : '']: '50',
      [f.ok ? f.data!.id : '']: '999', // formula value must be dropped
    });
    expect(res.ok).toBe(true);
    const table = await getTable(tableId);
    const row = table!.rows.find((r) => r.id === (res.ok ? res.data!.id : ''));
    expect(row?.values[before]).toBe('Товар');
    expect(row?.values[num.ok ? num.data!.id : '']).toBe('50');
    expect(row?.values[f.ok ? f.data!.id : '']).toBeUndefined(); // formula not persisted
  });
});

describe('knowledge tables — cells (atomic jsonb_set)', () => {
  it('updates a cell and preserves sibling cells on the same row', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    const c2 = await addColumnAction(tableId, 'Второй', 'TEXT');
    const col2 = c2.ok ? c2.data!.id : '';

    let table = await getTable(tableId);
    const rowId = table!.rows[0]!.id;
    const col1 = table!.columns[0]!.id;

    await updateCellAction(rowId, col1, 'значение-1');
    await updateCellAction(rowId, col2, 'значение-2');

    table = await getTable(tableId);
    const vals = table!.rows[0]!.values;
    // jsonb_set on col2 must NOT have wiped col1.
    expect(vals[col1]).toBe('значение-1');
    expect(vals[col2]).toBe('значение-2');
  });

  it('concurrent edits to two cells of one row both survive (the no-clobber guarantee)', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    const c2 = await addColumnAction(tableId, 'Второй', 'TEXT');
    const col2 = c2.ok ? c2.data!.id : '';
    const table0 = await getTable(tableId);
    const rowId = table0!.rows[0]!.id;
    const col1 = table0!.columns[0]!.id;

    // Fire both updates in parallel against the SAME row. A read-modify-write
    // implementation would lose one value here; atomic jsonb_set keeps both.
    await Promise.all([
      updateCellAction(rowId, col1, 'парал-1'),
      updateCellAction(rowId, col2, 'парал-2'),
    ]);

    const table = await getTable(tableId);
    const vals = table!.rows[0]!.values;
    expect(vals[col1]).toBe('парал-1');
    expect(vals[col2]).toBe('парал-2');
  });
});

describe('knowledge tables — deletes & cascade', () => {
  it('deleting a column and row works; deleting the table cascades', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    const c = await addColumnAction(tableId, 'X', 'TEXT');
    const r = await addRowAction(tableId);

    expect((await deleteColumnAction(c.ok ? c.data!.id : '')).ok).toBe(true);
    expect((await deleteRowAction(r.ok ? r.data!.id : '')).ok).toBe(true);

    const del = await deleteTableAction(tableId);
    expect(del.ok).toBe(true);
    expect(await prisma.knowledgeTable.count({ where: { id: tableId } })).toBe(0);
    expect(await prisma.knowledgeTableColumn.count({ where: { tableId } })).toBe(0);
    expect(await prisma.knowledgeTableRow.count({ where: { tableId } })).toBe(0);
  });
});

describe('knowledge tables — permissions', () => {
  it('VIEWER cannot create tables, columns, rows, or edit cells', async () => {
    await asUser('ADMIN');
    const spaceId = await freshSpace();
    const t = await createTableAction(spaceId);
    const tableId = t.ok ? t.data!.id : '';
    const table = await getTable(tableId);
    const rowId = table!.rows[0]!.id;
    const colId = table!.columns[0]!.id;

    await asUser('VIEWER');
    expect((await createTableAction(spaceId)).ok).toBe(false);
    expect((await addColumnAction(tableId, 'Нельзя', 'TEXT')).ok).toBe(false);
    expect((await addRowAction(tableId)).ok).toBe(false);
    expect((await updateCellAction(rowId, colId, 'x')).ok).toBe(false);
  });
});
