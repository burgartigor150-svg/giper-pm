'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { Pencil } from 'lucide-react';
import { updateTaskAction } from '@/actions/tasks';
import { useT } from '@/lib/useT';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  initial: string;
  canEdit: boolean;
};

export function InlineTitle({ taskId, projectKey, taskNumber, initial, canEdit }: Props) {
  const t = useT('tasks.detail');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (value.trim() === initial.trim() || value.trim().length < 2) {
      setEditing(false);
      setValue(initial);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateTaskAction(taskId, projectKey, taskNumber, { title: value.trim() });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setEditing(false);
    });
  }

  if (!canEdit || !editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{value}</h1>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('editTitle')}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            else if (e.key === 'Escape') {
              setEditing(false);
              setValue(initial);
            }
          }}
          autoFocus
          disabled={pending}
          className="text-2xl font-semibold"
        />
        <Button size="sm" type="button" onClick={save} disabled={pending}>
          {t('saveTitle')}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={() => {
            setEditing(false);
            setValue(initial);
          }}
        >
          {t('cancelTitle')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
