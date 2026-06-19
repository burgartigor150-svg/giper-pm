'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import Link from 'next/link';
import { X, Check } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { Input } from '@giper/ui/components/Input';
import { moveDealStageAction, setDealStatusAction, updateDealAction } from '@/actions/crm';
import type { BoardDeal, PipelineView } from '@/lib/crm';

type ContactOption = { id: string; name: string };
type ProjectOption = { id: string; key: string; name: string };
type Stage = PipelineView['stages'][number];

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
 * CRM pipeline board with drag-and-drop between stages + a deal drawer.
 * Dragging a card to another stage flips WON/LOST server-side (and prompts for
 * a lost reason on a LOST move). Clicking a card opens a drawer to view/edit
 * the deal and set its status. Non-editors get a read-only board + drawer.
 */
export function DealPipeline({
  pipeline,
  deals: propDeals,
  canEdit,
  contacts = [],
  projects = [],
}: {
  pipeline: PipelineView;
  deals: BoardDeal[];
  canEdit: boolean;
  contacts?: ContactOption[];
  projects?: ProjectOption[];
}) {
  const router = useRouter();
  const [deals, setDeals] = useState<BoardDeal[]>(propDeals);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Server re-render (router.refresh) is the source of truth — re-sync local
  // optimistic state whenever the prop changes.
  useEffect(() => setDeals(propDeals), [propDeals]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStage = useMemo(() => {
    const map = new Map<string, BoardDeal[]>();
    for (const s of pipeline.stages) map.set(s.id, []);
    for (const d of deals) map.get(d.stageId)?.push(d);
    return map;
  }, [deals, pipeline.stages]);

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) ?? null : null;
  const openDeal = openId ? deals.find((d) => d.id === openId) ?? null : null;

  function move(dealId: string, toStageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === toStageId) return;
    const stage = pipeline.stages.find((s) => s.id === toStageId);
    if (!stage) return;
    const lostReason =
      stage.kind === 'LOST'
        ? (window.prompt('Причина проигрыша (необязательно):', '') ?? '').trim()
        : '';
    const nextStatus = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
    const prev = deals;
    // Optimistic.
    setDeals((cur) =>
      cur.map((d) => (d.id === dealId ? { ...d, stageId: toStageId, status: nextStatus } : d)),
    );
    setError(null);
    startTransition(async () => {
      const res = await moveDealStageAction(dealId, toStageId);
      if (!res.ok) {
        setDeals(prev);
        setError(res.error.message);
        return;
      }
      if (lostReason) {
        const r2 = await setDealStatusAction(dealId, 'LOST', { lostReason });
        if (!r2.ok) setError(r2.error.message);
      }
      router.refresh();
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const toStageId = overId.startsWith('stage-')
      ? overId.slice('stage-'.length)
      : deals.find((d) => d.id === overId)?.stageId;
    if (toStageId) move(String(active.id), toStageId);
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => {
          setActiveId(String(e.active.id));
          setError(null);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {pipeline.stages.map((stage) => {
            const cards = byStage.get(stage.id) ?? [];
            const sum = cards.reduce((acc, d) => acc + (d.amount ?? 0), 0);
            return (
              <StageColumn key={stage.id} stage={stage} count={cards.length} sum={sum}>
                {cards.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    draggable={canEdit}
                    onOpen={() => setOpenId(d.id)}
                  />
                ))}
                {cards.length === 0 ? (
                  <p className="px-1 py-2 text-center text-xs text-muted-foreground">—</p>
                ) : null}
              </StageColumn>
            );
          })}
        </div>
        <DragOverlay>
          {activeDeal ? <DealCardView deal={activeDeal} /> : null}
        </DragOverlay>
      </DndContext>

      {openDeal ? (
        <DealDrawer
          deal={openDeal}
          stages={pipeline.stages}
          contacts={contacts}
          projects={projects}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function StageColumn({
  stage,
  count,
  sum,
  children,
}: {
  stage: Stage;
  count: number;
  sum: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className={cn('rounded-t-md border border-b-0 px-3 py-2', STAGE_TINT[stage.kind])}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{stage.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
        </div>
        {sum > 0 ? (
          <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(sum, 'RUB')}</div>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[6rem] flex-1 flex-col gap-2 rounded-b-md border p-2 transition-colors',
          STAGE_TINT[stage.kind],
          isOver ? 'outline outline-2 outline-foreground outline-offset-[-2px]' : '',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  draggable,
  onOpen,
}: {
  deal: BoardDeal;
  draggable: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isDragging) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className={cn(
        'cursor-pointer rounded-md border border-border bg-background p-2 text-left text-sm shadow-sm hover:border-foreground/30',
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
        isDragging ? 'opacity-50' : '',
      )}
    >
      <DealCardBody deal={deal} />
    </div>
  );
}

/** Visual-only card body (shared by the draggable card + the drag overlay). */
function DealCardView({ deal }: { deal: BoardDeal }) {
  return (
    <div className="w-72 rounded-md border border-border bg-background p-2 text-sm shadow-lg">
      <DealCardBody deal={deal} />
    </div>
  );
}

function DealCardBody({ deal }: { deal: BoardDeal }) {
  return (
    <>
      <div className="truncate font-medium" title={deal.title}>{deal.title}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="tabular-nums text-muted-foreground">{fmtMoney(deal.amount, deal.currency)}</span>
        {deal.status === 'WON' ? <span className="text-emerald-600">Выиграна</span> : null}
        {deal.status === 'LOST' ? <span className="text-rose-600">Проиграна</span> : null}
      </div>
      {deal.contactName ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{deal.contactName}</div>
      ) : null}
    </>
  );
}

function DealDrawer({
  deal,
  stages,
  contacts,
  projects,
  canEdit,
  onClose,
  onSaved,
}: {
  deal: BoardDeal;
  stages: Stage[];
  contacts: ContactOption[];
  projects: ProjectOption[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(deal.title);
  const [amount, setAmount] = useState(deal.amount != null ? String(deal.amount) : '');
  const [contactId, setContactId] = useState(deal.contactId ?? '');
  const [projectId, setProjectId] = useState(deal.projectId ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stageName = stages.find((s) => s.id === deal.stageId)?.name ?? '—';

  function save() {
    setError(null);
    if (title.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    startTransition(async () => {
      const res = await updateDealAction(deal.id, {
        title,
        amount: amount.trim() === '' ? null : amount,
        contactId: contactId || null,
        projectId: projectId || null,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onSaved();
      onClose();
    });
  }

  function setStatus(status: 'OPEN' | 'WON' | 'LOST') {
    setError(null);
    const lostReason =
      status === 'LOST'
        ? (window.prompt('Причина проигрыша (необязательно):', deal.lostReason ?? '') ?? '').trim()
        : undefined;
    startTransition(async () => {
      const res = await setDealStatusAction(deal.id, status, lostReason ? { lostReason } : {});
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/20" onClick={onClose} role="presentation" />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Сделка"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="truncate text-sm font-semibold">{deal.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Стадия</dt>
            <dd className="col-span-2">{stageName}</dd>
            <dt className="text-muted-foreground">Статус</dt>
            <dd className="col-span-2">
              {deal.status === 'WON' ? 'Выиграна' : deal.status === 'LOST' ? 'Проиграна' : 'Открыта'}
            </dd>
            <dt className="text-muted-foreground">Сумма</dt>
            <dd className="col-span-2 tabular-nums">{fmtMoney(deal.amount, deal.currency)}</dd>
            <dt className="text-muted-foreground">Контакт</dt>
            <dd className="col-span-2">{deal.contactName ?? '—'}</dd>
            <dt className="text-muted-foreground">Проект</dt>
            <dd className="col-span-2">
              {deal.projectKey ? (
                <Link
                  href={`/projects/${deal.projectKey}`}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  <span className="font-mono text-xs">{deal.projectKey}</span>
                  {deal.projectName ? ` · ${deal.projectName}` : ''}
                </Link>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-muted-foreground">Ответственный</dt>
            <dd className="col-span-2">{deal.ownerName ?? '—'}</dd>
            {deal.status === 'LOST' && deal.lostReason ? (
              <>
                <dt className="text-muted-foreground">Причина</dt>
                <dd className="col-span-2 text-rose-600">{deal.lostReason}</dd>
              </>
            ) : null}
          </dl>

          {canEdit ? (
            <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Редактировать
              </span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Сумма"
                inputMode="decimal"
                className="tabular-nums"
              />
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                aria-label="Контакт"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">— без контакта —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Проект"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">— без проекта —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.key} · {p.name}</option>
                ))}
              </select>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex items-center justify-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
              >
                <Check className="size-3.5" /> Сохранить
              </button>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('WON')}
                  disabled={pending || deal.status === 'WON'}
                  className="flex-1 rounded-md border border-emerald-300 px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Выиграна
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('LOST')}
                  disabled={pending || deal.status === 'LOST'}
                  className="flex-1 rounded-md border border-rose-300 px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  Проиграна
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('OPEN')}
                  disabled={pending || deal.status === 'OPEN'}
                  className="flex-1 rounded-md border border-input px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Открыта
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
