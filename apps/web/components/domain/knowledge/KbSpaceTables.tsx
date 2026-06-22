'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Database, Plus } from 'lucide-react';
import { createTableAction } from '@/actions/knowledgeTables';

type TableItem = {
  id: string;
  name: string;
  icon: string | null;
  _count: { columns: number; rows: number };
};

/** "Умные таблицы" section on the space page: list + create. */
export function KbSpaceTables({
  spaceId,
  tables,
  canEdit,
}: {
  spaceId: string;
  tables: TableItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const res = await createTableAction(spaceId);
      if (res.ok && res.data) router.push(`/knowledge/table/${res.data.id}`);
      else if (!res.ok) alert(res.error.message);
    });
  }

  if (tables.length === 0 && !canEdit) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Database className="h-4 w-4" /> Умные таблицы
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          >
            <Plus className="h-3.5 w-3.5" /> Таблица
          </button>
        ) : null}
      </div>
      {tables.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-xs text-muted-foreground dark:border-neutral-700">
          Таблиц пока нет.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tables.map((t) => (
            <li key={t.id}>
              <Link
                href={`/knowledge/table/${t.id}`}
                className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                <span className="shrink-0 text-lg">{t.icon ?? '🗄️'}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t._count.columns} столб. · {t._count.rows} стр.
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
