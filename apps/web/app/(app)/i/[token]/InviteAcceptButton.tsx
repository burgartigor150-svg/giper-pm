'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptChannelInviteAction } from '@/actions/messenger';

export function InviteAcceptButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function accept() {
    setError(null);
    start(async () => {
      const r = await acceptChannelInviteAction(token);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (!r.data) {
        setError('Не удалось вступить');
        return;
      }
      router.push(`/messages/${r.data.channelId}`);
    });
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {pending ? 'Вступаем…' : 'Вступить в канал'}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
