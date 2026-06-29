'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAutoMoveParentOnChildAction } from '@/actions/board';

/**
 * Opt-in toggle for "auto-move parent by subtasks' status" (Kaiten parity).
 * Optimistic; rolls back on error. Off by default.
 */
export function AutoMoveParentToggle({
  projectId,
  initial,
}: {
  projectId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setAutoMoveParentOnChildAction(projectId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setOn(!next);
        setError(res.error.message);
      }
    });
  }

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        disabled={pending}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input"
      />
      <span className="text-sm">
        Автоматически двигать родительскую карточку по статусу подзадач
        <span className="mt-0.5 block text-xs text-muted-foreground">
          → «В работе», когда хотя бы одна подзадача взята в работу; → «Готово», когда все
          (не отменённые) подзадачи выполнены. Только вперёд — назад родителя не двигает.
        </span>
        {error ? <span className="mt-0.5 block text-xs text-destructive">{error}</span> : null}
      </span>
    </label>
  );
}
