'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { createDefaultPipelineAction } from '@/actions/crm';

export function CreateDefaultPipelineButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createDefaultPipelineAction();
          if (res.ok) router.refresh();
        })
      }
    >
      {pending ? 'Создаю…' : 'Создать воронку продаж'}
    </Button>
  );
}
