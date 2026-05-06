'use client';

import { useActionState, useRef, useEffect } from 'react';
import { Button } from '@giper/ui/components/Button';
import { addCommentAction, type ActionResult } from '@/actions/tasks';
import { useT } from '@/lib/useT';

const initial: ActionResult = { ok: true };

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
};

export function CommentForm({ taskId, projectKey, taskNumber }: Props) {
  const t = useT('tasks.detail');
  const action = addCommentAction.bind(null, taskId, projectKey, taskNumber);
  const [state, formAction, pending] = useActionState(action, initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Clear textarea on success
  useEffect(() => {
    if (state && state.ok && ref.current) ref.current.value = '';
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <textarea
        ref={ref}
        name="body"
        placeholder={t('commentPlaceholder')}
        required
        className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {state && !state.ok ? (
        <p className="text-xs text-destructive">{state.error.message}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {t('addComment')}
        </Button>
      </div>
    </form>
  );
}
