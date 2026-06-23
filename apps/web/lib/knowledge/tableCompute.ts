import { evaluateFormula } from './formula';
import type { KbColumn, KbRow, KbRelationOption } from './getTables';

/** Relation options keyed by the RELATION column's target tableId. */
export type KbRelationMap = Record<string, KbRelationOption[]>;

/** Format a computed number compactly (integers plain, else ≤6 decimals). */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

/**
 * Compute a FORMULA cell for one row: `{Column Name}` refs resolve to sibling
 * columns' values in the same row. A ref to another FORMULA column recurses
 * (chained formulas like `{Итого}` = `{Сумма}` + `{НДС}`); a `visited` set makes
 * cycles return null instead of recursing forever. Returns null on any bad ref /
 * parse error / non-finite result (evaluateFormula is total — no throw, no eval).
 */
export function computeFormula(
  col: KbColumn,
  row: KbRow,
  columns: KbColumn[],
  visited: Set<string> = new Set(),
): number | null {
  if (!col.formulaExpr) return null;
  if (visited.has(col.id)) return null; // circular reference
  const seen = new Set(visited).add(col.id);
  const byName = new Map(columns.map((c) => [c.name, c]));
  return evaluateFormula(col.formulaExpr, (name) => {
    const ref = byName.get(name);
    if (!ref) return null;
    if (ref.type === 'FORMULA') return computeFormula(ref, row, columns, seen);
    const raw = row.values[ref.id];
    if (raw === undefined || raw === '') return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  });
}

/** Numeric value of a cell for sorting (FORMULA computed, NUMBER parsed). */
export function cellNumber(col: KbColumn, row: KbRow, columns: KbColumn[]): number {
  if (col.type === 'FORMULA') return computeFormula(col, row, columns) ?? 0;
  return parseFloat(row.values[col.id] ?? '') || 0;
}

/** Human label for a RELATION cell value (the stored target row id). */
export function relationLabel(col: KbColumn, value: string, relations: KbRelationMap): string {
  if (!value) return '';
  const opts = (col.relationTableId && relations[col.relationTableId]) || [];
  return opts.find((o) => o.id === value)?.label ?? '—';
}

/**
 * Display string for any cell in read-only contexts (board cards, calendar).
 * Editable surfaces (the grid) render their own inputs instead.
 */
export function displayCellValue(
  col: KbColumn,
  row: KbRow,
  columns: KbColumn[],
  relations: KbRelationMap,
): string {
  if (col.type === 'FORMULA') {
    const v = computeFormula(col, row, columns);
    return v === null ? '' : formatNumber(v);
  }
  if (col.type === 'RELATION') return relationLabel(col, row.values[col.id] ?? '', relations);
  const raw = row.values[col.id] ?? '';
  if (col.type === 'CHECKBOX') return raw === 'true' ? '✓' : '';
  return raw;
}
