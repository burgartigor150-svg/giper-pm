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
import { attachProjectAndRerunAiAction } from '@/actions/meetings';
import type { ApplyOverrides } from '@/actions/aiHarvest';

type Segment = { start: number; end: number; text: string; speaker?: string };
type Proposal = {
  proposalId: string;
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  suggestedAssigneeId: string | null;
  /** Raw first-name lifted from the transcript when LLM didn't pick
   * a unique member id. UI shows a candidates picker. */
  mentionedAssigneeName?: string | null;
  suggestedDueDate: string | null;
  rationale: string;
};
type Member = { id: string; name: string };
type Candidate = { id: string; name: string; email: string; inProject: boolean };

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
  speakerMap,
  availableProjects,
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
  /**
   * Maps WhisperX speaker labels (SPEAKER_00, SPEAKER_01, …) to the
   * real participant names we have in MeetingParticipant. Applied
   * both to the per-segment chip and to the AI summary text — the
   * summary often quotes SPEAKER_00 directly.
   */
  speakerMap?: Record<string, string>;
  /**
   * Projects the current user can route a no-project meeting into.
   * Only used when projectKey === null — surfaces an "attach to
   * project + rerun AI" picker so the PM can salvage task proposals
   * from a meeting they forgot to scope.
   */
  availableProjects?: { key: string; name: string }[];
}) {
  // Replace SPEAKER_xx tokens with real names anywhere a label might
  // appear. We swap by descending key length first to avoid SPEAKER_0
  // matching inside SPEAKER_01 (the labels themselves are zero-padded
  // so order rarely matters, but the safe rule is free).
  const speakerEntries = Object.entries(speakerMap ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );
  const renderSpeaker = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    return speakerMap?.[raw] ?? raw;
  };
  const substituteInText = (text: string): string => {
    if (speakerEntries.length === 0) return text;
    let out = text;
    for (const [label, name] of speakerEntries) {
      out = out.split(label).join(name);
    }
    return out;
  };
  const summaryText = transcript.summary
    ? substituteInText(transcript.summary)
    : null;
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

      {summaryText ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Саммари ИИ</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
            {summaryText}
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
                      {renderSpeaker(s.speaker)}
                    </span>
                  ) : null}
                  <span className="leading-snug">{s.text}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <MeetingTasksPanel
          meetingId={meetingId}
          projectKey={projectKey}
          availableProjects={availableProjects ?? []}
        />
      </div>
    </div>
  );
}

function MeetingTasksPanel({
  meetingId,
  projectKey,
  availableProjects,
}: {
  meetingId: string;
  projectKey: string | null;
  availableProjects: { key: string; name: string }[];
}) {
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

  // Late-attach branch: meeting was created without a project. Show
  // a picker + "rerun AI" button instead of an empty proposals list.
  // We don't render the picker on permanent errors — only on the
  // soft "no project" case that this UI is specifically here to fix.
  if (projectKey === null) {
    return (
      <AttachProjectPanel
        meetingId={meetingId}
        availableProjects={availableProjects}
      />
    );
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
                meetingId={meetingId}
                onCreate={() => setEditingId(p.proposalId)}
                onDiscard={() => discard(p)}
                onResolved={(pid, userId, userName) => {
                  // Local-only — the picked assignee lives in component
                  // state until the user clicks "Создать", at which
                  // point applyMeetingProposalAction takes assigneeId
                  // from overrides. We also push the user into
                  // `members` so the ProposalEditor's <select> shows
                  // their name as the preselected option.
                  setProposals((prev) =>
                    prev
                      ? prev.map((x) =>
                          x.proposalId === pid
                            ? { ...x, suggestedAssigneeId: userId }
                            : x,
                        )
                      : prev,
                  );
                  setMembers((prev) =>
                    prev.some((m) => m.id === userId)
                      ? prev
                      : [...prev, { id: userId, name: userName }],
                  );
                }}
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
  meetingId,
  onCreate,
  onDiscard,
  onResolved,
}: {
  proposal: Proposal;
  members: Member[];
  meetingId: string;
  onCreate: () => void;
  onDiscard: () => void;
  /** Called when the user picks a candidate from the disambiguation
   *  list — parent updates its proposal cache so next render shows
   *  the chosen assignee. */
  onResolved: (proposalId: string, userId: string, userName: string) => void;
}) {
  const assigneeName = members.find((m) => m.id === proposal.suggestedAssigneeId)?.name ?? '—';
  const needsPick =
    !proposal.suggestedAssigneeId && !!proposal.mentionedAssigneeName;
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
      {needsPick ? (
        <MentionedAssigneePicker
          meetingId={meetingId}
          proposalId={proposal.proposalId}
          mentionedName={proposal.mentionedAssigneeName!}
          onPick={(u) => onResolved(proposal.proposalId, u.id, u.name)}
        />
      ) : null}
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

/**
 * Inline picker for an ambiguous mentioned name. We don't try to
 * pre-load candidates with the proposal — that would mean N queries
 * for every meeting view. Instead we fetch lazily on first interaction.
 */
function MentionedAssigneePicker({
  meetingId,
  proposalId,
  mentionedName,
  onPick,
}: {
  meetingId: string;
  proposalId: string;
  mentionedName: string;
  onPick: (u: Candidate) => void;
}) {
  void proposalId;
  const [opened, setOpened] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setOpened(true);
    if (candidates !== null) return;
    setError(null);
    startTransition(async () => {
      // Lazy import to avoid pulling the server-action bundle on cards
      // that never need disambiguation.
      const { searchCandidateAssigneesAction } = await import(
        '@/actions/aiMeeting'
      );
      const r = await searchCandidateAssigneesAction({
        meetingId,
        mentionedName,
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setCandidates(r.candidates);
    });
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={open}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
      >
        Упомянут: «{mentionedName}» — выбрать исполнителя
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="mb-1 text-[11px] text-muted-foreground">
        В транскрипте сказано «{mentionedName}». Найдены кандидаты:
      </p>
      {pending && candidates === null ? (
        <p className="text-[11px] text-muted-foreground">Ищем…</p>
      ) : error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : !candidates || candidates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Совпадений по имени не найдено. Назначите вручную после создания задачи.
        </p>
      ) : (
        <ul className="space-y-1">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-amber-100 dark:hover:bg-amber-950/60"
              >
                <span className="flex items-center gap-1">
                  <span className="font-medium">{c.name}</span>
                  {c.inProject ? (
                    <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                      в проекте
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpened(false)}
        className="mt-1 text-[11px] text-muted-foreground hover:underline"
      >
        Свернуть
      </button>
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

/**
 * Salvage UI for meetings created without a project. Lets the PM pick
 * one of THEIR projects and rerun the AI layer on the existing
 * transcript (cheap — no WhisperX re-run). After success the page
 * reloads itself; the next render will see projectKey set and show
 * the normal proposals panel.
 */
function AttachProjectPanel({
  meetingId,
  availableProjects,
}: {
  meetingId: string;
  availableProjects: { key: string; name: string }[];
}) {
  const [selected, setSelected] = useState<string>(
    availableProjects[0]?.key ?? '',
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const r = await attachProjectAndRerunAiAction({
        meetingId,
        projectKey: selected,
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setSubmitted(true);
      // The worker normally finishes the AI rerun in 5-10s on Gemini
      // Flash. Reload after a short delay so the page re-fetches with
      // the new projectKey + status=READY.
      setTimeout(() => {
        window.location.reload();
      }, 6000);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Предложенные задачи</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Встреча не привязана к проекту, поэтому ИИ не предлагал задачи. Выберите проект — ИИ
          перечитает транскрипт и предложит задачи для него.
        </p>
        {availableProjects.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            У вас нет проектов, в которых можно создавать задачи. Попросите PM добавить вас.
          </p>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={pending || submitted}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {availableProjects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            {submitted ? (
              <p className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                Готово, ИИ работает. Страница обновится автоматически…
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending || submitted || !selected}
              className="w-full"
            >
              {pending ? 'Запускаю…' : 'Привязать и сгенерировать задачи'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
