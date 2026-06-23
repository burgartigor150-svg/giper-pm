import Link from 'next/link';
import { Database } from 'lucide-react';
import type { KbColumn, KbRow } from '@/lib/knowledge/getTables';
import { displayCellValue } from '@/lib/knowledge/tableCompute';

/**
 * Read-only render of a smart table embedded in an article via the
 * `[[table:ID]]` token. Server-compatible (no 'use client') so it works in both
 * the server article view and the client editor preview.
 */
export function KbEmbeddedTable({
  name,
  icon,
  columns,
  rows,
}: {
  name: string;
  icon: string | null;
  columns: KbColumn[];
  rows: KbRow[];
}) {
  return (
    <div className="my-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-1.5 border-b border-neutral-200 px-3 py-2 text-sm font-medium dark:border-neutral-800">
        <span>{icon ?? <Database className="h-4 w-4 text-muted-foreground" />}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{rows.length} строк</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="border border-neutral-200 bg-muted px-2 py-1 text-left font-semibold dark:border-neutral-800">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  // Read-only embed: FORMULA computes; RELATION shows its label
                  // (or «—» when target rows aren't loaded in the embed context).
                  <td key={c.id} className="border border-neutral-200 px-2 py-1 align-top dark:border-neutral-800">
                    {displayCellValue(c, row, columns, {})}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} className="border border-neutral-200 px-2 py-2 text-center text-xs text-muted-foreground dark:border-neutral-800">
                  Нет строк.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Placeholder shown in the editor preview where embed data isn't loaded. */
export function KbEmbeddedTablePlaceholder({ id }: { id: string }) {
  return (
    <div className="my-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-muted-foreground dark:border-neutral-700">
      <Database className="h-3.5 w-3.5" /> Таблица <code className="font-mono">{id}</code> — отобразится в статье
    </div>
  );
}
