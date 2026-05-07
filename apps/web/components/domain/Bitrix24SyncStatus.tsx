'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { resolveBitrixConflictAction } from '@/actions/tasks';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  syncedAt: Date | string | null;
  conflict: boolean;
};

/**
 * Compact sync indicator for mirrored tasks. Two states:
 *
 *   1. OK — green check + "Синхронизировано N мин назад". Hover for the
 *      exact timestamp.
 *   2. Conflict — amber banner with two buttons: "оставить нашу" pushes
 *      our local state to Bitrix; "принять Bitrix" accepts the upstream
 *      value (which is already on our row from the inbound apply).
 *
 * Lives in the right-hand TaskSidebar block on mirrored tasks. Hidden
 * for tasks created locally.
 */
export function Bitrix24SyncStatus({
  taskId,
  projectKey,
  taskNumber,
  syncedAt,
  conflict,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(side: 'local' | 'remote') {
    setError(null);
    startTransition(async () => {
      const res = await resolveBitrixConflictAction(taskId, projectKey, taskNumber, side);
      if (!res.ok) setError(res.error.message);
    });
  }

  if (conflict) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-900">Расхождение с Bitrix24</p>
            <p className="mt-1 text-xs text-amber-800">
              Кто-то изменил задачу в Bitrix, пока вы правили её здесь. Выберите, какая
              версия должна победить.
            </p>
            {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => resolve('local')}
              >
                Оставить нашу
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => resolve('remote')}
              >
                Принять Bitrix
              </Button>
              {pending ? (
                <span className="inline-flex items-center text-xs text-amber-700">
                  <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                  Синхронизация…
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!syncedAt) {
    return (
      <div className="text-xs text-muted-foreground">Ещё не синхронизировано</div>
    );
  }

  const date = new Date(syncedAt);
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={date.toLocaleString('ru-RU')}
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      <span>Синхронизировано {formatRelative(date)}</span>
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'только что';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  return d.toLocaleDateString('ru-RU');
}
