'use client';

import { useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { retranscribeMeetingAction } from '@/actions/meetings';

export function MeetingRetryButton({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await retranscribeMeetingAction({ meetingId });
          // Surface "Записи ещё нет" / "Нет прав" instead of silently
          // flipping the label back with nothing happening.
          if (!r.ok) alert(r.message);
        });
      }}
    >
      {pending ? 'Запускаю…' : 'Перезапустить транскрибацию'}
    </Button>
  );
}
