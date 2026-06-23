'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { renameTableAction, deleteTableAction } from '@/actions/knowledgeTables';

/** Smart-table page header: editable name + delete (non-VIEWER). */
export function KbTableHeader({
  tableId,
  spaceId,
  name,
  icon,
  canEdit,
}: {
  tableId: string;
  spaceId: string;
  name: string;
  icon: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(name);

  function commit() {
    if (value === name) return;
    startTransition(async () => {
      const res = await renameTableAction(tableId, value);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function remove() {
    if (!confirm(`Удалить таблицу «${name}»?`)) return;
    startTransition(async () => {
      const res = await deleteTableAction(tableId);
      if (res.ok) router.push(`/knowledge/space/${spaceId}`);
      else alert(res.error.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl">{icon ?? '🗄️'}</span>
      {canEdit ? (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-bold outline-none"
        />
      ) : (
        <h1 className="min-w-0 flex-1 text-2xl font-bold">{name}</h1>
      )}
      {canEdit ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-md border border-neutral-300 p-1.5 text-muted-foreground hover:text-red-600 dark:border-neutral-700"
          aria-label="Удалить таблицу"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
