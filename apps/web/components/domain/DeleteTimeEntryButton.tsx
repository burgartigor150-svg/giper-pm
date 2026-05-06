'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { deleteTimeEntryAction } from '@/actions/time';
import { useT } from '@/lib/useT';

export function DeleteTimeEntryButton({ entryId }: { entryId: string }) {
  const t = useT('time.form');
  const [pending, startTransition] = useTransition();

  function handle() {
    if (!confirm(t('deleteConfirm'))) return;
    startTransition(() => {
      deleteTimeEntryAction(entryId);
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={handle}
      disabled={pending}
      aria-label={t('delete')}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
