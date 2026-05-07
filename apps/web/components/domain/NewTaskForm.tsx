'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { createTaskAction, type ActionResult } from '@/actions/tasks';
import { useT } from '@/lib/useT';

const initial: ActionResult = { ok: true };

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const TYPES = ['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE'] as const;

type Member = { id: string; name: string };

type Props = {
  projectKey: string;
  members: Member[];
  /** True when the parent project is mirrored to Bitrix24 — only then
   *  the "publish to Bitrix" affordance has anywhere to go. */
  projectMirrored?: boolean;
};

export function NewTaskForm({ projectKey, members, projectMirrored = false }: Props) {
  const tForm = useT('tasks.form');
  const tPrio = useT('tasks.priority');
  const tType = useT('tasks.type');
  const tErr = useT('tasks.errors');

  const action = createTaskAction.bind(null, projectKey);
  const [state, formAction, pending] = useActionState(action, initial);
  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="title">
          {tForm('title')}
        </label>
        <Input id="title" name="title" placeholder={tForm('titlePlaceholder')} required />
        {fieldErrors?.title?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.title[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="description">
          {tForm('description')}
        </label>
        <textarea
          id="description"
          name="description"
          placeholder={tForm('descriptionPlaceholder')}
          className="min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="priority">{tForm('priority')}</label>
          <select
            id="priority"
            name="priority"
            defaultValue="MEDIUM"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{tPrio(p)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="type">{tForm('type')}</label>
          <select
            id="type"
            name="type"
            defaultValue="TASK"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{tType(t)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="assigneeId">{tForm('assignee')}</label>
          <select
            id="assigneeId"
            name="assigneeId"
            defaultValue=""
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="estimateHours">{tForm('estimate')}</label>
          <Input id="estimateHours" name="estimateHours" type="number" min="0" step="0.25" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="dueDate">{tForm('due')}</label>
          <Input id="dueDate" name="dueDate" type="date" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="tags">{tForm('tags')}</label>
        <Input id="tags" name="tags" placeholder={tForm('tagsPlaceholder')} />
      </div>

      {projectMirrored ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-input bg-muted/30 p-3 text-sm">
          <input
            type="checkbox"
            name="publishToBitrix"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Опубликовать в Bitrix24</span>
            <span className="text-xs text-muted-foreground">
              Создать соответствующую задачу в рабочей группе Bitrix24.
              Для внутренних задач (черновики, тех-долг) — снимите галку.
            </span>
          </span>
        </label>
      ) : null}

      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {['INSUFFICIENT_PERMISSIONS', 'CONFLICT', 'VALIDATION', 'NOT_FOUND'].includes(state.error.code)
            ? tErr(state.error.code as 'INSUFFICIENT_PERMISSIONS' | 'CONFLICT' | 'VALIDATION' | 'NOT_FOUND')
            : state.error.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Link href={`/projects/${projectKey}/list`}>
          <Button type="button" variant="outline">{tForm('cancel')}</Button>
        </Link>
        <Button type="submit" disabled={pending}>{tForm('submit')}</Button>
      </div>
    </form>
  );
}
