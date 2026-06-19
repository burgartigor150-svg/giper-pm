'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignTaskToSprintAction } from '@/actions/sprints';
import type { SprintView } from '@/lib/sprints/getSprints';

type Props = {
  taskId: string;
  currentSprintId: string | null;
  sprints: Pick<SprintView, 'id' | 'name' | 'status'>[];
  canEdit: boolean;
};

/** Sidebar control to put a task into a sprint (or back to the backlog). */
export function SprintPicker({ taskId, currentSprintId, sprints, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentSprintId ?? '');
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await assignTaskToSprintAction(taskId, next || null);
      if (res.ok) router.refresh();
      else {
        setError(res.error.message);
        setValue(currentSprintId ?? '');
      }
    });
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Спринт</span>
      <span className="flex items-center gap-1.5">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <select
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => change(e.target.value)}
          className="h-9 max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Бэклог</option>
          {sprints
            .filter((s) => s.status !== 'CLOSED' || s.id === currentSprintId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === 'ACTIVE' ? ' (активный)' : ''}
              </option>
            ))}
        </select>
      </span>
    </label>
  );
}
