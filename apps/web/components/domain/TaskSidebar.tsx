'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Input } from '@giper/ui/components/Input';
import type { Position } from '@giper/db';
import { EstimateVsActual } from './EstimateVsActual';
import {
  setReviewerAction,
  updateTaskAction,
} from '@/actions/tasks';
import {
  addTaskAssignmentAction,
  removeTaskAssignmentAction,
  setInternalStatusAction,
} from '@/actions/assignments';
import { useT } from '@/lib/useT';
import { UserPicker } from './UserPicker';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const POSITIONS: Position[] = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE',
  'QA', 'QA_AUTO',
  'DESIGNER', 'UX',
  'ANALYST', 'BA',
  'PM', 'LEAD',
  'DEVOPS', 'SRE',
  'CONTENT', 'MARKETING',
  'OTHER',
];
const POSITION_LABELS: Record<Position, string> = {
  FRONTEND: 'Frontend',
  BACKEND: 'Backend',
  FULLSTACK: 'Fullstack',
  MOBILE: 'Mobile',
  QA: 'QA',
  QA_AUTO: 'QA Auto',
  DESIGNER: 'Designer',
  UX: 'UX',
  ANALYST: 'Analyst',
  BA: 'Business Analyst',
  PM: 'PM',
  LEAD: 'Lead',
  DEVOPS: 'DevOps',
  SRE: 'SRE',
  CONTENT: 'Content',
  MARKETING: 'Marketing',
  OTHER: 'Other',
};

type Member = { id: string; name: string; image: string | null };

type Assignment = {
  id: string;
  position: Position;
  user: { id: string; name: string; image: string | null };
};

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** Internal status — independent from the Bitrix-mirror Task.status. */
  internalStatus: (typeof STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  reviewer: { id: string; name: string; image: string | null } | null;
  assignments: Assignment[];
  estimate: string | null; // string from Decimal
  /** Total minutes spent on this task across all time entries (includes live timer). */
  spentMinutes: number;
  due: Date | string | null;
  tags: string[];
  members: Member[];
  canEdit: boolean;
  creator: { id: string; name: string; image: string | null };
  startedAt: Date | string | null;
  completedAt: Date | string | null;
};

function fmtDate(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU');
}

export function TaskSidebar(props: Props) {
  const t = useT('tasks.detail.sidebar');
  const tStatus = useT('tasks.status');
  const tPrio = useT('tasks.priority');

  const [pending, startTransition] = useTransition();
  const [estimate, setEstimate] = useState(props.estimate ?? '');
  const [due, setDue] = useState(props.due ? new Date(props.due).toISOString().slice(0, 10) : '');
  const [tags, setTags] = useState((props.tags ?? []).join(', '));

  // Per-field "saved" indicator. Shows a green check for ~1.2s after a
  // successful save so the user gets feedback without an intrusive toast.
  const [savedField, setSavedField] = useState<string | null>(null);
  useEffect(() => {
    if (!savedField) return;
    const id = setTimeout(() => setSavedField(null), 1200);
    return () => clearTimeout(id);
  }, [savedField]);

  function flash(field: string) {
    setSavedField(field);
  }

  function changeStatus(s: string) {
    startTransition(async () => {
      await setInternalStatusAction(props.taskId, props.projectKey, props.taskNumber, s);
      flash('status');
    });
  }
  function changePriority(p: string) {
    startTransition(async () => {
      await updateTaskAction(props.taskId, props.projectKey, props.taskNumber, {
        priority: p as (typeof PRIORITIES)[number],
      });
      flash('priority');
    });
  }
  function saveScalar(
    field: 'estimateHours' | 'dueDate' | 'tags',
    value: unknown,
    flashKey: string,
  ) {
    startTransition(async () => {
      await updateTaskAction(props.taskId, props.projectKey, props.taskNumber, {
        [field]: value,
      } as Record<string, unknown>);
      flash(flashKey);
    });
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Field
        label={`${t('status')} (внутренний)`}
        saved={savedField === 'status'}
      >
        <select
          value={props.internalStatus}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={!props.canEdit || pending}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{tStatus(s)}</option>
          ))}
        </select>
      </Field>

      <Field label="Назначены (роли)" saved={savedField === 'assignments'}>
        <AssignmentList
          taskId={props.taskId}
          projectKey={props.projectKey}
          taskNumber={props.taskNumber}
          assignments={props.assignments}
          members={props.members}
          canEdit={props.canEdit}
          onChanged={() => flash('assignments')}
        />
      </Field>

      <Field label="Ревьюер" saved={savedField === 'reviewer'}>
        <UserPicker
          value={props.reviewer ?? null}
          preload={props.members}
          disabled={!props.canEdit || pending}
          placeholder="— без ревьюера —"
          onPick={(user) => {
            startTransition(async () => {
              await setReviewerAction(
                props.taskId,
                props.projectKey,
                props.taskNumber,
                user?.id ?? null,
              );
              flash('reviewer');
            });
          }}
        />
        {props.reviewer ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar src={props.reviewer.image} alt={props.reviewer.name} className="h-5 w-5" />
            {props.reviewer.name}
            <span className="text-[10px] uppercase tracking-wide">
              решает «закрывать или нет»
            </span>
          </div>
        ) : null}
      </Field>

      <Field label={t('priority')} saved={savedField === 'priority'}>
        <select
          value={props.priority}
          onChange={(e) => changePriority(e.target.value)}
          disabled={!props.canEdit || pending}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{tPrio(p)}</option>
          ))}
        </select>
      </Field>

      <Field label={t('estimate')} saved={savedField === 'estimate'}>
        <Input
          type="number"
          min="0"
          step="0.25"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          onBlur={() => {
            const v = estimate.trim();
            if (v === (props.estimate ?? '')) return;
            saveScalar('estimateHours', v === '' ? undefined : Number(v), 'estimate');
          }}
          disabled={!props.canEdit || pending}
        />
        <div className="mt-2">
          <EstimateVsActual
            estimateHours={props.estimate}
            spentMinutes={props.spentMinutes}
          />
        </div>
      </Field>

      <Field label={t('due')} saved={savedField === 'due'}>
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          onBlur={() => {
            const initial = props.due
              ? new Date(props.due).toISOString().slice(0, 10)
              : '';
            if (due === initial) return;
            saveScalar('dueDate', due === '' ? undefined : due, 'due');
          }}
          disabled={!props.canEdit || pending}
        />
      </Field>

      <Field label={t('tags')} saved={savedField === 'tags'}>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const initial = (props.tags ?? []).join(', ');
            if (tags === initial) return;
            const arr = tags
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            saveScalar('tags', arr, 'tags');
          }}
          disabled={!props.canEdit || pending}
          placeholder="tag1, tag2"
        />
      </Field>

      <div className="border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{t('creator')}</span>
          <span className="inline-flex items-center gap-2">
            <Avatar src={props.creator.image} alt={props.creator.name} className="h-5 w-5" />
            {props.creator.name}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>{t('started')}</span>
          <span>{fmtDate(props.startedAt)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>{t('completed')}</span>
          <span>{fmtDate(props.completedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  saved = false,
}: {
  label: string;
  children: React.ReactNode;
  saved?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {saved ? (
          <Check className="h-3 w-3 text-emerald-600" aria-label="Сохранено" />
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * Inline editor for the multi-assignee block. Pairs (user, role)
 * each get a row; an "add" affordance at the bottom expands into a
 * tiny picker (member dropdown + role dropdown). Same person can
 * appear with several roles — each row is its own assignment.
 */
function AssignmentList({
  taskId,
  projectKey,
  taskNumber,
  assignments,
  members,
  canEdit,
  onChanged,
}: {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  assignments: Assignment[];
  members: Member[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [pickUserId, setPickUserId] = useState('');
  const [pickPosition, setPickPosition] = useState<Position>('FRONTEND');
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!pickUserId) {
      setError('Выберите участника');
      return;
    }
    startTransition(async () => {
      const res = await addTaskAssignmentAction(
        taskId,
        projectKey,
        taskNumber,
        pickUserId,
        pickPosition,
      );
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setAdding(false);
        setPickUserId('');
        onChanged();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeTaskAssignmentAction(id, projectKey, taskNumber);
      if (res.ok) onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {assignments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Никто не назначен.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="group flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <Avatar src={a.user.image} alt={a.user.name} className="h-5 w-5" />
              <span className="flex-1 truncate">{a.user.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {POSITION_LABELS[a.position]}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  aria-label="Снять назначение"
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        adding ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-input bg-background p-2">
            <UserPicker
              value={
                pickUserId
                  ? members.find((m) => m.id === pickUserId) ?? null
                  : null
              }
              preload={members}
              placeholder="— участник —"
              clearable={false}
              onPick={(u) => setPickUserId(u?.id ?? '')}
            />
            <select
              value={pickPosition}
              onChange={(e) => setPickPosition(e.target.value as Position)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_LABELS[p]}
                </option>
              ))}
            </select>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={add}
                disabled={pending}
                className="flex-1 rounded-md bg-foreground px-2 py-1 text-xs text-background hover:opacity-90 disabled:opacity-50"
              >
                Назначить
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <Plus className="h-3 w-3" />
            Назначить
          </button>
        )
      ) : null}
    </div>
  );
}
