'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { deleteTaskAction } from '@/actions/tasks';
import { useT } from '@/lib/useT';

type Props = {
  taskId: string;
  projectKey: string;
};

export function DeleteTaskButton({ taskId, projectKey }: Props) {
  const t = useT('tasks.detail');
  const [pending, startTransition] = useTransition();

  function handle() {
    if (!confirm(t('deleteConfirm'))) return;
    startTransition(async () => {
      // On success the action redirect()s to the list (handled by Next);
      // only a failure (e.g. no permission) returns a result here.
      const res = await deleteTaskAction(taskId, projectKey);
      if (res && !res.ok) alert(res.error.message);
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      onClick={handle}
      disabled={pending}
    >
      <Trash2 className="h-4 w-4" />
      {t('delete')}
    </Button>
  );
}
