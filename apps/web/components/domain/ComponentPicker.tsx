'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTaskComponentAction } from '@/actions/components';

type ComponentOption = { id: string; name: string };

type Props = {
  taskId: string;
  currentComponentId: string | null;
  components: ComponentOption[];
  canEdit: boolean;
};

/** Sidebar control to assign a card to a component (or clear it). */
export function ComponentPicker({ taskId, currentComponentId, components, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentComponentId ?? '');
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setTaskComponentAction(taskId, next || null);
      if (res.ok) router.refresh();
      else {
        setError(res.error.message);
        setValue(currentComponentId ?? '');
      }
    });
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Компонент</span>
      <span className="flex items-center gap-1.5">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <select
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => change(e.target.value)}
          className="h-9 max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Без компонента</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
