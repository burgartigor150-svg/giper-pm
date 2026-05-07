'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { syncTeamFromBitrixAction } from '@/actions/integrations';

/**
 * Trigger a Bitrix24 sync for every member of the current PM's
 * roster. Without this the team-tasks feed stays empty when team
 * members have tasks in Bitrix that the PM themselves never touched
 * — the default mine-only sync only sees the PM's own work.
 *
 * Long-running (one full sync per member). The button shows progress
 * and a per-member result summary when done.
 */
export function SyncTeamFromBitrixButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(force: boolean) {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const res = await syncTeamFromBitrixAction({ force });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      const total = res.perMember.reduce(
        (acc, m) => acc + m.created + m.updated,
        0,
      );
      const lines = res.perMember
        .filter((m) => m.created + m.updated + m.comments > 0)
        .map(
          (m) =>
            `${m.name}: +${m.created} новых, ${m.updated} обновлено, ${m.comments} комментариев`,
        );
      setSummary(
        total === 0
          ? 'Синк прошёл — новых задач у команды нет.'
          : lines.join(' · '),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-60"
        >
          <RefreshCw
            className={'h-3.5 w-3.5 ' + (pending ? 'animate-spin' : '')}
          />
          Синхронизировать команду из Bitrix24
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={pending}
          title="Полный sync — игнорирует watermark, тянет всю историю за 30 дней"
          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
        >
          Полный
        </button>
      </div>
      {summary ? (
        <p className="text-xs text-emerald-700 whitespace-pre-wrap">{summary}</p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
