'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTaskVersionAction } from '@/actions/versions';

type VersionOption = { id: string; name: string; status: 'PLANNED' | 'RELEASED' | 'ARCHIVED' };

type Props = {
  taskId: string;
  currentVersionId: string | null;
  versions: VersionOption[];
  canEdit: boolean;
};

/** Sidebar control to slate a card for a release/version (or clear it). */
export function VersionPicker({ taskId, currentVersionId, versions, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentVersionId ?? '');
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTaskVersionAction(taskId, next || null);
      if (res.ok) router.refresh();
      else {
        setError(res.error.message);
        setValue(currentVersionId ?? '');
      }
    });
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Версия</span>
      <span className="flex items-center gap-1.5">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <select
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => change(e.target.value)}
          className="h-9 max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Без версии</option>
          {versions
            // Hide archived versions unless the card is already on one.
            .filter((v) => v.status !== 'ARCHIVED' || v.id === currentVersionId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.status === 'RELEASED' ? ' (выпущена)' : ''}
              </option>
            ))}
        </select>
      </span>
    </label>
  );
}
