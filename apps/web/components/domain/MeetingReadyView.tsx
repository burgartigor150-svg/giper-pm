'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import {
  applyMeetingProposalAction,
  discardMeetingProposalAction,
  getMeetingProposalsAction,
} from '@/actions/aiMeeting';
import type { ApplyOverrides } from '@/actions/aiHarvest';

type Segment = { start: number; end: number; text: string; speaker?: string };
type Proposal = {
  proposalId: string;
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  suggestedAssigneeId: string | null;
  suggestedDueDate: string | null;
  rationale: string;
};
type Member = { id: string; name: string };

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

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MeetingReadyView({
  meetingId,
  title,
  recordingUrl,
  durationSec,
  transcript,
  projectKey,
}: {
  meetingId: string;
  title: string;
  recordingUrl: string | null;
  durationSec: number | null;
  transcript: {
    fullText: string;
    segments: Segment[];
    summary: string | null;
    language: string | null;
  };
  projectKey: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  function jumpTo(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    void v.play();
  }

  // Group segments by speaker for compact display.
  const speakers = Array.from(new Set(transcript.segments.map((s) => s.speaker).filter(Boolean))) as string[];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/meetings" className="text-xs text-muted-foreground underline">
            ← Все встречи
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">
            {durationSec ? `${Math.round(durationSec / 60)} мин` : 'длительность неизвестна'}
            {transcript.language ? ` · язык: ${transcript.language}` : ''}
            {speakers.length ? ` · спикеров: ${speakers.length}` : ''}
          </p>
        </div>
        {projectKey ? (
          <Link href={`/projects/${projectKey}`} className="text-sm font-mono underline">
            {projectKey} →
          </Link>
        ) : null}
      </div>

      {recordingUrl ? (
        <Card>
          <CardContent className="p-2">
            <video
              ref={videoRef}
              src={recordingUrl}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-md bg-black"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Запись недоступна (egress не сработал).
          </CardContent>
        </Card>
      )}

      {transcript.summary ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Саммари ИИ</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
            {transcript.summary}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Транскрипт</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[60vh] space-y-2 overflow-y-auto">
            {transcript.segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Распознавание ничего не дало.</p>
            ) : (
              transcript.segments.map((s, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => jumpTo(s.start)}
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-foreground hover:text-background"
                    title="Перейти к этому моменту записи"
                  >
                    {fmt(s.start)}
                  </button>
                  {s.speaker ? (
                    <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                      {s.speaker}
                    </span>
                  ) : null}
                  <span className="leading-snug">{s.text}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <MeetingTasksPanel meetingId={meetingId} />
      </div>
    </div>
  );
}

function MeetingTasksPanel({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function load() {
    setError(null);
    startTransition(async () => {
      const r = await getMeetingProposalsAction({ meetingId });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setProposals(r.proposals as Proposal[]);
      setMembers(r.members);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  function discard(p: Proposal) {
    setProposals((prev) => (prev ? prev.filter((x) => x.proposalId !== p.proposalId) : prev));
    void discardMeetingProposalAction({ meetingId, proposalId: p.proposalId });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Предложенные задачи</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[60vh] space-y-3 overflow-y-auto">
        {pending && proposals === null ? (
          <p className="text-xs text-muted-foreground">Загружаем предложения ИИ…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : proposals && proposals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            ИИ не нашёл явных задач в этой встрече. Можно создать вручную из транскрипта или
            саммари.
          </p>
        ) : (
          proposals?.map((p) =>
            editingId === p.proposalId ? (
              <ProposalEditor
                key={p.proposalId}
                meetingId={meetingId}
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
          )
        )}
      </CardContent>
    </Card>
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
  const assigneeName = members.find((m) => m.id === proposal.suggestedAssigneeId)?.name ?? '—';
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{proposal.title}</h3>
        <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px]">
          {TYPE_LABEL[proposal.type]} · {PRIORITY_LABEL[proposal.priority]}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{proposal.description}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {assigneeName !== '—' ? `Исполнитель: ${assigneeName}` : ''}
        {proposal.suggestedDueDate ? ` · срок: ${proposal.suggestedDueDate}` : ''}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDiscard}>
          Отклонить
        </Button>
        <Button type="button" size="sm" onClick={onCreate}>
          Создать →
        </Button>
      </div>
    </div>
  );
}

function ProposalEditor({
  meetingId,
  proposal,
  members,
  onCancel,
  onCreated,
}: {
  meetingId: string;
  proposal: Proposal;
  members: Member[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ taskNumber: number; projectKey: string } | null>(null);

  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [type, setType] = useState<ApplyOverrides['type']>(proposal.type);
  const [priority, setPriority] = useState<ApplyOverrides['priority']>(proposal.priority);
  const [assigneeId, setAssigneeId] = useState<string>(proposal.suggestedAssigneeId ?? '');
  const [dueDate, setDueDate] = useState<string>(proposal.suggestedDueDate ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const r = await applyMeetingProposalAction({
        meetingId,
        proposalId: proposal.proposalId,
        overrides: {
          title: title.trim(),
          description,
          type,
          priority,
          assigneeId: assigneeId || null,
          dueDate: dueDate || null,
        },
      });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setDone({ taskNumber: r.taskNumber, projectKey: r.projectKey });
      setTimeout(onCreated, 1500);
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border-2 border-foreground/30 bg-card p-3 shadow-md">
      <div className="space-y-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Название" />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[70px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          placeholder="Описание"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ApplyOverrides['type'])}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          >
            {(['TASK', 'BUG', 'FEATURE', 'CHORE', 'EPIC'] as const).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ApplyOverrides['priority'])}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          >
            {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Без исполнителя</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
      {done ? (
        <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Создано: {done.projectKey}-{done.taskNumber}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={pending || !!done}>
          {pending ? 'Создаю…' : 'Создать'}
        </Button>
      </div>
    </form>
  );
}
