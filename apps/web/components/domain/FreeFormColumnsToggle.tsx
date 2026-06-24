'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Columns3 } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { setFreeFormColumnsEnabledAction } from '@/actions/board';

/**
 * Board-header switch for the per-project free-form columns mode. Enabling it
 * materializes the default columns (server-side) and reveals the inline
 * add/rename/delete/reorder controls. Only rendered for project editors.
 */
export function FreeFormColumnsToggle({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setErr(null);
    start(async () => {
      const res = await setFreeFormColumnsEnabledAction(projectId, next);
      if (res.ok) router.refresh();
      else {
        setOn(!next);
        setErr(res.error.message);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-60',
        on
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-input text-muted-foreground hover:text-foreground',
      )}
      title={
        err ??
        'Свободные колонки: добавляйте, переименовывайте, удаляйте и переупорядочивайте колонки прямо на доске'
      }
    >
      <Columns3 className="h-3.5 w-3.5" />
      Свободные колонки: {on ? 'вкл' : 'выкл'}
    </button>
  );
}
