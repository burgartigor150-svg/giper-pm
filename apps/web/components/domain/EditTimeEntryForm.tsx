'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { editTimeEntryAction, type ActionResult } from '@/actions/time';
import { searchTasks, type TaskSearchHit } from '@/actions/tasks';
import { useT } from '@/lib/useT';

const initial: ActionResult = { ok: true };

type Props = {
  entryId: string;
  initial: {
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    note: string;
    task: TaskSearchHit | null;
  };
};

export function EditTimeEntryForm({ entryId, initial: init }: Props) {
  const t = useT('time.form');
  const tErr = useT('time.errors');
  const tTimer = useT('time.timer');
  const action = editTimeEntryAction.bind(null, entryId);
  const [state, formAction, pending] = useActionState(action, initial);

  const [taskQuery, setTaskQuery] = useState('');
  const [taskPicked, setTaskPicked] = useState<TaskSearchHit | null>(init.task);
  const [results, setResults] = useState<TaskSearchHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const wrapRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setShowResults(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = taskQuery.trim();
    if (q.length < 2 || taskPicked) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setResults(await searchTasks(q));
      setShowResults(true);
    }, 250);
    return () => clearTimeout(id);
  }, [taskQuery, taskPicked]);

  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3" ref={wrapRef}>
      <input type="hidden" name="taskId" value={taskPicked?.id ?? ''} />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">{t('taskOptional')}</label>
        {taskPicked ? (
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-muted px-2 py-1 text-xs">
              <span className="font-mono">{taskPicked.projectKey}-{taskPicked.number}</span>{' '}
              {taskPicked.title}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTaskPicked(null);
                setTaskQuery('');
              }}
            >
              ×
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Input
              type="search"
              placeholder={t('noTask')}
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
            />
            {showResults && results.length > 0 ? (
              <div className="absolute left-0 right-0 top-11 z-10 max-h-60 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setTaskPicked(r);
                      setShowResults(false);
                    }}
                    className="flex w-full items-start gap-2 px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.projectKey}-{r.number}
                    </span>
                    <span className="flex-1 truncate">{r.title}</span>
                  </button>
                ))}
              </div>
            ) : showResults && taskQuery.trim().length >= 2 ? (
              <div className="absolute left-0 right-0 top-11 z-10 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-md">
                {tTimer('noResults')}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{t('date')}</label>
          <Input type="date" name="date" defaultValue={init.date} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{t('startTime')}</label>
          <Input type="time" name="startTime" defaultValue={init.startTime} required />
          {fieldErrors?.startedAt?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.startedAt[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{t('endTime')}</label>
          <Input type="time" name="endTime" defaultValue={init.endTime} required />
          {fieldErrors?.endedAt?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.endedAt[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">{t('note')}</label>
        <textarea
          name="note"
          defaultValue={init.note}
          className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {state.error.code in { VALIDATION: 1, NOT_FOUND: 1, INSUFFICIENT_PERMISSIONS: 1 }
            ? tErr(state.error.code as 'VALIDATION' | 'NOT_FOUND' | 'INSUFFICIENT_PERMISSIONS')
            : state.error.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Link href="/time">
          <Button type="button" variant="outline">{t('cancel')}</Button>
        </Link>
        <Button type="submit" disabled={pending}>{t('submit')}</Button>
      </div>
    </form>
  );
}
