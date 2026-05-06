'use client';

import { useState, useTransition } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import {
  assignTaskAction,
  changeStatusAction,
  updateTaskAction,
} from '@/actions/tasks';
import { useT } from '@/lib/useT';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

type Member = { id: string; name: string; image: string | null };

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  status: (typeof STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  assignee: { id: string; name: string; image: string | null } | null;
  estimate: string | null; // string from Decimal
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

  function changeStatus(s: string) {
    startTransition(() => {
      changeStatusAction(props.taskId, props.projectKey, props.taskNumber, s);
    });
  }
  function changeAssignee(id: string) {
    startTransition(() => {
      assignTaskAction(props.taskId, props.projectKey, props.taskNumber, id || null);
    });
  }
  function changePriority(p: string) {
    startTransition(() => {
      updateTaskAction(props.taskId, props.projectKey, props.taskNumber, {
        priority: p as (typeof PRIORITIES)[number],
      });
    });
  }
  function saveScalar(field: 'estimateHours' | 'dueDate' | 'tags', value: unknown) {
    startTransition(() => {
      updateTaskAction(props.taskId, props.projectKey, props.taskNumber, {
        [field]: value,
      } as Record<string, unknown>);
    });
  }

  return (
    <div className={`flex flex-col gap-4 text-sm ${pending ? 'opacity-70' : ''}`}>
      <Field label={t('status')}>
        <select
          value={props.status}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={!props.canEdit || pending}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{tStatus(s)}</option>
          ))}
        </select>
      </Field>

      <Field label={t('assignee')}>
        <select
          value={props.assignee?.id ?? ''}
          onChange={(e) => changeAssignee(e.target.value)}
          disabled={!props.canEdit || pending}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t('unassigned')}</option>
          {props.members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {props.assignee ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar src={props.assignee.image} alt={props.assignee.name} className="h-5 w-5" />
            {props.assignee.name}
          </div>
        ) : null}
      </Field>

      <Field label={t('priority')}>
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

      <Field label={t('estimate')}>
        <Input
          type="number"
          min="0"
          step="0.25"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          onBlur={() => {
            const v = estimate.trim();
            saveScalar('estimateHours', v === '' ? undefined : Number(v));
          }}
          disabled={!props.canEdit || pending}
        />
      </Field>

      <Field label={t('due')}>
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          onBlur={() => {
            saveScalar('dueDate', due === '' ? undefined : due);
          }}
          disabled={!props.canEdit || pending}
        />
      </Field>

      <Field label={t('tags')}>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const arr = tags
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            saveScalar('tags', arr);
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

      <Button type="button" variant="outline" disabled>
        ▶ Запустить таймер
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
