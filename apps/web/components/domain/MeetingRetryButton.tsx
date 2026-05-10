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
          await retranscribeMeetingAction({ meetingId });
        });
      }}
    >
      {pending ? 'Запускаю…' : 'Перезапустить транскрибацию'}
    </Button>
  );
}
