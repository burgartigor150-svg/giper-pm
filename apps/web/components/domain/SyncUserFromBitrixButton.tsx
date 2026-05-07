'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { syncUserFromBitrixAction } from '@/actions/users';

type Props = {
  userId: string;
  /** True when the local row already has a bitrixUserId — used to soften
   *  the button label from "Подтянуть" to "Обновить". */
  alreadyLinked: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  bitrixUserId: 'Bitrix ID',
  name: 'Имя',
  image: 'Аватар',
  timezone: 'Часовой пояс',
};

/**
 * One-click button on the user detail page. Calls the server action,
 * displays a precise after-the-fact status:
 *   - "matched=false" → "В Bitrix не найден по email"
 *   - "updatedFields.length=0" → "Уже актуально"
 *   - else → "Обновлено: Имя · Аватар"
 */
export function SyncUserFromBitrixButton({ userId, alreadyLinked }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setFeedback(null);
    setError(null);
    startTransition(async () => {
      const res = await syncUserFromBitrixAction(userId);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      if (!res.matched) {
        setFeedback('В Bitrix24 не найден по email');
        return;
      }
      if (res.updatedFields.length === 0) {
        setFeedback('Данные уже актуальны');
      } else {
        const human = res.updatedFields.map((f) => FIELD_LABELS[f] ?? f).join(' · ');
        setFeedback(`Обновлено: ${human}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-2 self-start rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-60"
      >
        <RefreshCw className={'h-3.5 w-3.5 ' + (pending ? 'animate-spin' : '')} />
        {alreadyLinked ? 'Обновить из Bitrix24' : 'Подтянуть из Bitrix24'}
      </button>
      {feedback ? (
        <p className="text-xs text-emerald-700">{feedback}</p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
