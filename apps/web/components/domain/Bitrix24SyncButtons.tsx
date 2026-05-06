'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { triggerBitrix24SyncAction } from '@/actions/integrations';

type Result =
  | null
  | {
      ok: true;
      msg: string;
    }
  | {
      ok: false;
      msg: string;
    };

/**
 * Two-button card: "Sync now" runs the incremental cycle (fast on subsequent
 * runs); "Force full resync" rewinds the watermark and pulls everything from
 * scratch — a few minutes on a busy portal.
 */
export function Bitrix24SyncButtons() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  function trigger(force: boolean) {
    setResult(null);
    start(async () => {
      const res = await triggerBitrix24SyncAction({ force });
      if (res.ok) {
        const d = res.data!;
        setResult({
          ok: true,
          msg: `Готово за ${(d.durationMs / 1000).toFixed(1)}с — создано ${d.created}, обновлено ${d.updated}`,
        });
        router.refresh();
      } else {
        setResult({ ok: false, msg: res.error.message });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button onClick={() => trigger(false)} disabled={pending}>
          {pending ? 'Синхронизация…' : 'Синхронизировать сейчас'}
        </Button>
        <Button variant="outline" onClick={() => trigger(true)} disabled={pending}>
          Полный resync
        </Button>
      </div>
      {result ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            result.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {result.msg}
        </p>
      ) : null}
    </div>
  );
}
