'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { Input } from '@giper/ui/components/Input';
import { moveDealStageAction, setDealStatusAction, updateDealAction } from '@/actions/crm';
import type { BoardDeal, PipelineView } from '@/lib/crm';

type ContactOption = { id: string; name: string };

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
 * flips the deal status server-side. Editors can also edit a deal inline
 * (title / amount / contact).
 */
export function DealPipeline({
  pipeline,
  deals,
  canEdit,
  contacts = [],
}: {
  pipeline: PipelineView;
  deals: BoardDeal[];
  canEdit: boolean;
  contacts?: ContactOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function move(dealId: string, stageId: string) {
    // Moving into a LOST stage: capture an optional reason. setDealStatusAction
    // already supports lostReason but nothing reached it before — the stage
    // move alone set status=LOST with the reason permanently null.
    const stage = pipeline.stages.find((s) => s.id === stageId);
    const lostReason =
      stage?.kind === 'LOST'
        ? (window.prompt('Причина проигрыша (необязательно):', '') ?? '').trim()
        : '';
    startTransition(async () => {
      const res = await moveDealStageAction(dealId, stageId);
      if (!res.ok) {
        alert(res.error.message);
        return;
      }
      if (lostReason) {
        const r2 = await setDealStatusAction(dealId, 'LOST', { lostReason });
        if (!r2.ok) alert(r2.error.message);
      }
      router.refresh();
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
                <DealCard
                  key={d.id}
                  deal={d}
                  stages={pipeline.stages}
                  contacts={contacts}
                  canEdit={canEdit}
                  movePending={pending}
                  onMove={move}
                />
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

function DealCard({
  deal: d,
  stages,
  contacts,
  canEdit,
  movePending,
  onMove,
}: {
  deal: BoardDeal;
  stages: PipelineView['stages'];
  contacts: ContactOption[];
  canEdit: boolean;
  movePending: boolean;
  onMove: (dealId: string, stageId: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(d.title);
  const [amount, setAmount] = useState(d.amount != null ? String(d.amount) : '');
  const [contactId, setContactId] = useState(d.contactId ?? '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (title.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    startTransition(async () => {
      const res = await updateDealAction(d.id, {
        title,
        amount: amount.trim() === '' ? null : amount,
        contactId: contactId || null,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2 text-sm shadow-sm">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" className="h-8 text-sm" />
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Сумма"
          inputMode="decimal"
          className="h-8 text-sm tabular-nums"
        />
        <select
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          aria-label="Контакт"
          className="h-8 rounded border border-input bg-background px-1 text-xs"
        >
          <option value="">— без контакта —</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-foreground px-2 py-1 text-xs text-background hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> Сохранить
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
              setTitle(d.title);
              setAmount(d.amount != null ? String(d.amount) : '');
              setContactId(d.contactId ?? '');
            }}
            className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-md border border-border bg-background p-2 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <div className="truncate font-medium" title={d.title}>{d.title}</div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Редактировать сделку ${d.title}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
      </div>
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
          disabled={movePending}
          onChange={(e) => onMove(d.id, e.target.value)}
          aria-label="Стадия"
          className="mt-1.5 h-8 w-full rounded border border-input bg-background px-1 text-xs"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              → {s.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
