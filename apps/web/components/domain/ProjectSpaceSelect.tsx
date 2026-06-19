'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setProjectSpaceAction } from '@/actions/spaces';

type Props = {
  projectKey: string;
  currentSpaceId: string | null;
  spaces: { id: string; name: string }[];
  canEdit: boolean;
};

/** Pick which space a project belongs to (or none). */
export function ProjectSpaceSelect({ projectKey, currentSpaceId, spaces, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentSpaceId ?? '');
  const [error, setError] = useState<string | null>(null);

  if (spaces.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Пространств пока нет. Создайте их в Настройки → Пространства.
      </p>
    );
  }

  function change(next: string) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setProjectSpaceAction(projectKey, next || null);
      if (res.ok) router.refresh();
      else {
        setError(res.error.message);
        setValue(currentSpaceId ?? '');
      }
    });
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">Пространство проекта</span>
      <span className="flex items-center gap-2">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <select
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => change(e.target.value)}
          className="h-9 max-w-[14rem] rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Без пространства</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </span>
    </label>
  );
}
