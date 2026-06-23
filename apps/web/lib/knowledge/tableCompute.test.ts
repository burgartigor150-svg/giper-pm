import { describe, it, expect } from 'vitest';
import { computeFormula, displayCellValue, relationLabel, formatNumber } from './tableCompute';
import type { KbColumn, KbRow } from './getTables';

const col = (over: Partial<KbColumn> & Pick<KbColumn, 'id' | 'name' | 'type'>): KbColumn => ({
  options: null,
  relationTableId: null,
  formulaExpr: null,
  order: 0,
  ...over,
});

const price = col({ id: 'c1', name: 'Цена', type: 'NUMBER' });
const qty = col({ id: 'c2', name: 'Кол-во', type: 'NUMBER' });
const sum = col({ id: 'c3', name: 'Сумма', type: 'FORMULA', formulaExpr: '{Цена} * {Кол-во}' });
const rel = col({ id: 'c4', name: 'Клиент', type: 'RELATION', relationTableId: 't2' });
const done = col({ id: 'c5', name: 'Готово', type: 'CHECKBOX' });
const columns = [price, qty, sum, rel, done];

const row: KbRow = { id: 'r1', order: 0, values: { c1: '100', c2: '3', c4: 'rowX', c5: 'true' } };
const relations = { t2: [{ id: 'rowX', label: 'ООО Ромашка' }] };

describe('computeFormula', () => {
  it('resolves {Column Name} refs to sibling numeric values', () => {
    expect(computeFormula(sum, row, columns)).toBe(300);
  });
  it('returns null when a referenced cell is empty/non-numeric', () => {
    expect(computeFormula(sum, { ...row, values: { c1: '100' } }, columns)).toBeNull();
    expect(computeFormula(sum, { ...row, values: { c1: '100', c2: 'abc' } }, columns)).toBeNull();
  });
});

describe('relationLabel', () => {
  it('maps a stored row id to its label', () => {
    expect(relationLabel(rel, 'rowX', relations)).toBe('ООО Ромашка');
  });
  it('shows «—» for an unknown id and empty for no value', () => {
    expect(relationLabel(rel, 'gone', relations)).toBe('—');
    expect(relationLabel(rel, '', relations)).toBe('');
  });
});

describe('displayCellValue', () => {
  it('formats formula, relation, checkbox and plain cells', () => {
    expect(displayCellValue(sum, row, columns, relations)).toBe('300');
    expect(displayCellValue(rel, row, columns, relations)).toBe('ООО Ромашка');
    expect(displayCellValue(done, row, columns, relations)).toBe('✓');
    expect(displayCellValue(price, row, columns, relations)).toBe('100');
  });
});

describe('formatNumber', () => {
  it('keeps integers plain and rounds long decimals', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(1 / 3)).toBe('0.333333');
  });
});
