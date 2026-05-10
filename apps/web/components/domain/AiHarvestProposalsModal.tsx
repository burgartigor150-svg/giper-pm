'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import {
  proposeAiHarvestAction,
  discardAiHarvestProposalAction,
  applyAiHarvestProposalAction,
  type ApplyOverrides,
} from '@/actions/aiHarvest';

type Member = { id: string; name: string };

type Proposal = {
  proposalId: string;
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  suggestedAssigneeId: string | null;
  suggestedDueDate: string | null;
  sourceMessageIds: string[];
  rationale: string;
};

const PRIORITY_LABEL: Record<Proposal['priority'], string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};
const TYPE_LABEL: Record<Proposal['type'] | 'EPIC', string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  FEATURE: 'Фича',
  CHORE: 'Рутина',
  EPIC: 'Эпик',
};

export function AiHarvestProposalsModal({
  open,
  onClose,
  linkId,
  chatTitle,
  triggerToken,
}: {
  open: boolean;
  onClose: () => void;
  linkId: string;
  chatTitle: string;
  /**
   * Bumping this number while `open=true` re-runs the analysis (used by
   * the parent's "Проанализировать" button to refresh).
   */
  triggerToken: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [usedMessages, setUsedMessages] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProposals(null);
    setEditingId(null);
    startTransition(async () => {
      const r = await proposeAiHarvestAction({ linkId });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setProposals(r.proposals as Proposal[]);
      setMembers(r.members);
      setUsedMessages(r.usedMessages);
      setTruncated(r.truncated);
    });
  }, [open, linkId, triggerToken]);

  if (!open) return null;

  function discard(p: Proposal) {
    setProposals((prev) => (prev ? prev.filter((x) => x.proposalId !== p.proposalId) : prev));
    void discardAiHarvestProposalAction({ linkId, proposalId: p.proposalId });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold">Анализ чата ИИ</h2>
            <p className="text-xs text-muted-foreground">{chatTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pending && proposals === null ? (
            <div className="space-y-2 py-12 text-center">
              <div className="text-sm font-medium">ИИ читает сообщения…</div>
              <p className="text-xs text-muted-foreground">
                Локальная модель Qwen 2.5 14B на сервере. Обычно занимает 5–30 секунд (первый запрос
                после простоя — до минуты, пока модель грузится в память).
              </p>
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : proposals && proposals.length === 0 ? (
            <div className="space-y-2 py-12 text-center">
              <div className="text-sm font-medium">ИИ не нашёл задач в чате</div>
              <p className="text-xs text-muted-foreground">
                Возможно, в буфере только болтовня и подтверждения. Попробуйте позже, когда наберётся
                содержательное обсуждение.
              </p>
            </div>
          ) : proposals ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Проанализировано сообщений: <strong>{usedMessages}</strong>
                {truncated ? ' (буфер обрезан)' : ''}. Выберите задачи для создания — каждая
                открывается в форме, где можно подправить поля и срок.
              </p>
              {proposals.map((p) =>
                editingId === p.proposalId ? (
                  <ProposalEditor
                    key={p.proposalId}
                    linkId={linkId}
                    proposal={p}
                    members={members}
                    onCancel={() => setEditingId(null)}
                    onCreated={() => {
                      setEditingId(null);
                      setProposals((prev) =>
                        prev ? prev.filter((x) => x.proposalId !== p.proposalId) : prev,
                      );
                    }}
                  />
                ) : (
                  <ProposalCard
                    key={p.proposalId}
                    proposal={p}
                    members={members}
                    onCreate={() => setEditingId(p.proposalId)}
                    onDiscard={() => discard(p)}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>
            Локальный Qwen 2.5 14B (Ollama). Сообщения никуда не уходят за пределы сервера.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </footer>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  members,
  onCreate,
  onDiscard,
}: {
  proposal: Proposal;
  members: Member[];
  onCreate: () => void;
  onDiscard: () => void;
}) {
  const assigneeName = members.find((m) => m.id === proposal.suggestedAssigneeId)?.name ?? null;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{proposal.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{proposal.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <span className="rounded-md border border-border px-2 py-0.5">
            {TYPE_LABEL[proposal.type]}
          </span>
          <PriorityBadge p={proposal.priority} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-wide">Исполнитель</dt>
          <dd className="text-foreground">{assigneeName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide">Срок</dt>
          <dd className="text-foreground">{proposal.suggestedDueDate ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide">Сообщений</dt>
          <dd className="text-foreground">{proposal.sourceMessageIds.length}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide">Почему</dt>
          <dd className="text-foreground line-clamp-2" title={proposal.rationale}>
            {proposal.rationale}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDiscard}>
          Отклонить
        </Button>
        <Button type="button" size="sm" onClick={onCreate}>
          Создать задачу →
        </Button>
      </div>
    </div>
  );
}

function PriorityBadge({ p }: { p: Proposal['priority'] }) {
  const cls =
    p === 'URGENT'
      ? 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200'
      : p === 'HIGH'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : p === 'LOW'
          ? 'bg-muted text-muted-foreground'
          : 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200';
  return <span className={`rounded-md px-2 py-0.5 ${cls}`}>{PRIORITY_LABEL[p]}</span>;
}

function ProposalEditor({
  linkId,
  proposal,
  members,
  onCancel,
  onCreated,
}: {
  linkId: string;
  proposal: Proposal;
  members: Member[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ taskNumber: number; projectKey: string; willDownloadFiles: number } | null>(null);

  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [type, setType] = useState<ApplyOverrides['type']>(proposal.type);
  const [priority, setPriority] = useState<ApplyOverrides['priority']>(proposal.priority);
  const [assigneeId, setAssigneeId] = useState<string>(proposal.suggestedAssigneeId ?? '');
  const [dueDate, setDueDate] = useState<string>(proposal.suggestedDueDate ?? '');
  const [estimateHours, setEstimateHours] = useState<string>('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const r = await applyAiHarvestProposalAction({
        linkId,
        proposalId: proposal.proposalId,
        overrides: {
          title: title.trim(),
          description,
          type,
          priority,
          assigneeId: assigneeId || null,
          dueDate: dueDate || null,
          estimateHours: estimateHours ? Number(estimateHours) : null,
        },
      });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setDone({
        taskNumber: r.taskNumber,
        projectKey: r.projectKey,
        willDownloadFiles: r.willDownloadFiles,
      });
      setTimeout(onCreated, 2200);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border-2 border-foreground/30 bg-card p-3 shadow-md"
    >
      <h3 className="mb-3 text-sm font-semibold">Создание задачи</h3>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Название
          </label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Описание
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Тип
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ApplyOverrides['type'])}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {(['TASK', 'BUG', 'FEATURE', 'CHORE', 'EPIC'] as const).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Приоритет
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ApplyOverrides['priority'])}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Исполнитель
            </label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Срок
            </label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Оценка (часы, опционально)
          </label>
          <Input
            type="number"
            min="0"
            step="0.25"
            value={estimateHours}
            onChange={(e) => setEstimateHours(e.target.value)}
          />
        </div>
      </div>

      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      {done ? (
        <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Создано: <strong>{done.projectKey}-{done.taskNumber}</strong>
          {done.willDownloadFiles > 0
            ? ` · файлов прикрепляется: ${done.willDownloadFiles} (бот скачает в фоне)`
            : ''}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={pending || !!done}>
          {pending ? 'Создаю…' : 'Создать задачу'}
        </Button>
      </div>
    </form>
  );
}
