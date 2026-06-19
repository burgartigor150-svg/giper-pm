'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@giper/ui/cn';
import { moveDealStageAction } from '@/actions/crm';
import type { BoardDeal, PipelineView } from '@/lib/crm';

const STAGE_TINT: Record<'NORMAL' | 'WON' | 'LOST', string> = {
  NORMAL: '',
  WON: 'bg-emerald-50',
  LOST: 'bg-rose-50',
};

function fmtMoney(amount: number | null, currency: string): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * CRM pipeline board: deals grouped under stage columns. v1 moves a deal via a
 * per-card stage dropdown (dnd is a follow-up). Dropping into a WON/LOST stage
 * flips the deal status server-side.
 */
export function DealPipeline({
  pipeline,
  deals,
  canEdit,
}: {
  pipeline: PipelineView;
  deals: BoardDeal[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function move(dealId: string, stageId: string) {
    startTransition(async () => {
      const res = await moveDealStageAction(dealId, stageId);
      if (res.ok) router.refresh();
    });
  }

  const byStage = new Map<string, BoardDeal[]>();
  for (const s of pipeline.stages) byStage.set(s.id, []);
  for (const d of deals) byStage.get(d.stageId)?.push(d);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {pipeline.stages.map((stage) => {
        const cards = byStage.get(stage.id) ?? [];
        const sum = cards.reduce((acc, d) => acc + (d.amount ?? 0), 0);
        return (
          <div key={stage.id} className="flex w-72 shrink-0 flex-col">
            <div className={cn('rounded-t-md border border-b-0 px-3 py-2', STAGE_TINT[stage.kind])}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{stage.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{cards.length}</span>
              </div>
              {sum > 0 ? (
                <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(sum, cards[0]?.currency ?? 'RUB')}</div>
              ) : null}
            </div>
            <div className={cn('flex min-h-[6rem] flex-1 flex-col gap-2 rounded-b-md border p-2', STAGE_TINT[stage.kind])}>
              {cards.map((d) => (
                <div key={d.id} className="rounded-md border border-border bg-background p-2 text-sm shadow-sm">
                  <div className="truncate font-medium" title={d.title}>{d.title}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground">{fmtMoney(d.amount, d.currency)}</span>
                    {d.status === 'WON' ? <span className="text-emerald-600">Выиграна</span> : null}
                    {d.status === 'LOST' ? <span className="text-rose-600">Проиграна</span> : null}
                  </div>
                  {d.contactName ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{d.contactName}</div>
                  ) : null}
                  {canEdit ? (
                    <select
                      value={d.stageId}
                      disabled={pending}
                      onChange={(e) => move(d.id, e.target.value)}
                      aria-label="Стадия"
                      className="mt-1.5 h-8 w-full rounded border border-input bg-background px-1 text-xs"
                    >
                      {pipeline.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          → {s.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ))}
              {cards.length === 0 ? (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">—</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
