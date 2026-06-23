'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, X } from 'lucide-react';
import {
  acceptKaitenSuggestionAction,
  rejectKaitenSuggestionAction,
} from '@/actions/kaitenIntegration';

export type KaitenSuggestionItem = {
  id: string;
  score: number;
  kaiten: { id: string; title: string; key: string };
  bitrix: { id: string; title: string; key: string };
};

/**
 * Manual review of medium-confidence Kaiten↔Bitrix matches. Accept creates a
 * DUPLICATES link; reject suppresses the pair so syncs stop re-proposing it.
 */
export function KaitenSuggestions({
  projectKey,
  initial,
  canManage,
}: {
  projectKey: string;
  initial: KaitenSuggestionItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (initial.length === 0) {
    return <p className="text-sm text-muted-foreground">Кандидатов на сопоставление нет.</p>;
  }

  function decide(id: string, accept: boolean) {
    setBusyId(id);
    setMsg(null);
    start(async () => {
      const res = accept
        ? await acceptKaitenSuggestionAction({ projectKey, suggestionId: id })
        : await rejectKaitenSuggestionAction({ projectKey, suggestionId: id });
      setBusyId(null);
      if (!res.ok) setMsg(`Ошибка: ${res.error}`);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Похожие задачи (по названию) ниже порога авто-связи — подтвердите дубликаты вручную.
      </p>
      <ul className="flex flex-col gap-2">
        {initial.map((s) => (
          <li key={s.id} className="rounded-md border border-border p-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-700">Kaiten</span>
              <span className="font-mono text-xs text-muted-foreground">{s.kaiten.key}</span>
              <span className="font-medium">{s.kaiten.title}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">Bitrix</span>
              <span className="font-mono text-xs text-muted-foreground">{s.bitrix.key}</span>
              <span>{s.bitrix.title}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">
                схожесть {(s.score * 100).toFixed(0)}%
              </span>
              {canManage ? (
                <>
                  <button
                    type="button"
                    onClick={() => decide(s.id, true)}
                    disabled={pending && busyId === s.id}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Link2 className="h-3.5 w-3.5" /> Связать дубли
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(s.id, false)}
                    disabled={pending && busyId === s.id}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Отклонить
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
    </div>
  );
}
