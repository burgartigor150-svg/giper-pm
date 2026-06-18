'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setStoryPointsAction } from '@/actions/assignments';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  initial: number | null;
  canEdit: boolean;
};

/** Compact Kaiten story-points (size) setter for the task sidebar. */
export function StoryPointsField({
  taskId,
  projectKey,
  taskNumber,
  initial,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initial != null ? String(initial) : '');
  const [saved, setSaved] = useState(false);

  function save() {
    const t = value.trim();
    const n = t === '' ? null : Math.floor(Number(t));
    const points = n != null && Number.isFinite(n) && n >= 0 && n <= 999 ? n : null;
    if (points === initial) return;
    startTransition(async () => {
      const res = await setStoryPointsAction(taskId, projectKey, taskNumber, points);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Story points</span>
      <span className="flex items-center gap-1.5">
        {saved ? <span className="text-xs text-emerald-600">✓</span> : null}
        <input
          type="number"
          min={0}
          max={999}
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          placeholder="—"
          className="h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
        />
      </span>
    </label>
  );
}
