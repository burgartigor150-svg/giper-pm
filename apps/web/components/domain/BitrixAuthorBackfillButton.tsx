'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { backfillBitrixCommentAuthorsAction } from '@/actions/bitrixMaintenance';

/**
 * One-click admin maintenance: reattribute Bitrix robot/system comments that were
 * wrongly pinned on a real person to the inert "Bitrix24" author. Loops the
 * bounded server action with its cursor until done, showing a running total — no
 * terminal / secret needed.
 */
export function BitrixAuthorBackfillButton() {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function run() {
    setStatus('Обрабатываю задачи Bitrix…');
    start(async () => {
      let total = 0;
      let after: string | undefined = undefined;
      for (let guard = 0; guard < 2000; guard++) {
        const res = await backfillBitrixCommentAuthorsAction(after);
        if (!res.ok) {
          setStatus(`Ошибка: ${res.error}`);
          return;
        }
        total += res.processed;
        if (res.done) {
          setStatus(`Готово. Перепроверено задач: ${total}. Обновите страницу задачи.`);
          return;
        }
        setStatus(`Обрабатываю задачи Bitrix… перепроверено: ${total}`);
        after = res.nextCursor ?? undefined;
      }
      setStatus(`Остановлено на ${total} задачах — нажмите ещё раз, чтобы продолжить.`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={run} disabled={pending} className="self-start">
        {pending ? 'Идёт исправление…' : 'Исправить авторов комментариев из Bitrix'}
      </Button>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      <p className="text-xs text-muted-foreground">
        Переназначит системные/роботные сообщения из Bitrix (смена срока, исполнителя и т.п.)
        на автора «Bitrix24» вместо вашего имени. Можно нажимать повторно — это безопасно.
      </p>
    </div>
  );
}
