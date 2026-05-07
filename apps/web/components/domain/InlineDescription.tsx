'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { updateTaskAction } from '@/actions/tasks';
import { useT } from '@/lib/useT';
import { renderRichText } from '@/lib/text/renderRichText';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  initial: string | null;
  canEdit: boolean;
};

export function InlineDescription({ taskId, projectKey, taskNumber, initial, canEdit }: Props) {
  const t = useT('tasks.detail');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? '');
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateTaskAction(taskId, projectKey, taskNumber, {
        description: value.trim() || undefined,
      });
      if (res.ok) setEditing(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('description')}
        </h2>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('editDescription')}
          </button>
        ) : null}
      </div>

      {editing ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" type="button" onClick={save} disabled={pending}>
              {t('saveTitle')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setValue(initial ?? '');
              }}
              disabled={pending}
            >
              {t('cancelTitle')}
            </Button>
          </div>
        </>
      ) : initial ? (
        <p className="whitespace-pre-wrap text-sm">{renderRichText(initial)}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">{t('descriptionEmpty')}</p>
      )}
    </div>
  );
}
