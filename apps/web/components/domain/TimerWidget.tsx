'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pause, Play, ArrowRightLeft } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { cn } from '@giper/ui/cn';
import { startTimerAction, stopTimerAction } from '@/actions/time';
import { searchTasks, type TaskSearchHit } from '@/actions/tasks';
import { useT } from '@/lib/useT';
import { LiveDuration } from './LiveDuration';

type ActiveTimer = {
  startedAt: Date | string;
  task: {
    id: string;
    number: number;
    title: string;
    project: { key: string };
  } | null;
};

type Props = {
  active: ActiveTimer | null;
};

/**
 * The header timer widget — the single live indicator of "what am I
 * working on right now". It does three jobs:
 *
 *   1. Shows the active task's project key, title, and live duration.
 *   2. Single click on the pause button stops the current timer.
 *   3. Switch button (or T-shortcut → toggle) opens a picker. Picking a
 *      task starts a new timer; the backend auto-stops the old one in a
 *      single transaction (single-active-timer invariant in startTimer).
 *
 * The T global shortcut hits this component via the `giper:toggle-timer`
 * window event — we keep the dispatch logic in KeyboardShortcuts so any
 * page can wire to the same event without prop-drilling.
 */
export function TimerWidget({ active }: Props) {
  const t = useT('time.timer');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const stop = useCallback(() => {
    startTransition(async () => {
      const res = await stopTimerAction();
      if (res.ok) router.refresh();
    });
  }, [router]);

  // T-shortcut handler:
  //   - timer running → stop
  //   - no timer → open picker
  // Mirrors what a user would expect from a single "toggle" key.
  useEffect(() => {
    const onToggle = () => {
      if (active?.task) stop();
      else setPickerOpen(true);
    };
    window.addEventListener('giper:toggle-timer', onToggle);
    return () => window.removeEventListener('giper:toggle-timer', onToggle);
  }, [active, stop]);

  if (active?.task) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
        <Link
          href={`/projects/${active.task.project.key}/tasks/${active.task.number}`}
          className="hidden min-w-0 items-center gap-2 text-xs hover:underline sm:flex"
          title={active.task.title}
        >
          <span className="font-mono text-muted-foreground">
            {active.task.project.key}-{active.task.number}
          </span>
          <span className="max-w-[180px] truncate text-foreground">
            {active.task.title}
          </span>
        </Link>
        <span className="font-mono text-xs tabular-nums">
          <LiveDuration startedAt={active.startedAt} />
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPickerOpen(true)}
          aria-label="Переключить задачу"
          title="Переключить задачу"
        >
          <ArrowRightLeft className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={stop}
          disabled={pending}
          aria-label={t('stop')}
        >
          <Pause className="h-3 w-3" />
        </Button>
        {pickerOpen ? (
          <TaskPicker
            mode="switch"
            onClose={() => setPickerOpen(false)}
            currentTaskId={active.task.id}
          />
        ) : null}
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setPickerOpen(true)}
        title="Запустить таймер (T)"
      >
        <Play className="h-3 w-3" />
        <span className="hidden sm:inline">{t('start')}</span>
      </Button>
      {pickerOpen ? <TaskPicker mode="start" onClose={() => setPickerOpen(false)} /> : null}
    </>
  );
}

function TaskPicker({
  onClose,
  mode,
  currentTaskId,
}: {
  onClose: () => void;
  mode: 'start' | 'switch';
  currentTaskId?: string;
}) {
  const t = useT('time.timer');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchHit[]>([]);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setResults(await searchTasks(q));
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  function pick(taskId: string) {
    startTransition(async () => {
      const res = await startTimerAction(taskId);
      if (res.ok) {
        onClose();
        router.refresh();
      }
    });
  }

  // Filter out the currently-running task from switch suggestions —
  // picking it would just be a no-op restart.
  const visible = currentTaskId ? results.filter((r) => r.id !== currentTaskId) : results;

  return (
    <div
      ref={wrapRef}
      className="absolute right-0 top-12 z-50 w-80 rounded-md border border-border bg-background p-3 shadow-md"
    >
      <div className="mb-2 text-xs text-muted-foreground">
        {mode === 'switch' ? 'Переключить таймер на:' : 'Запустить таймер:'}
      </div>
      <Input
        autoFocus
        value={query}
        placeholder={t('searchPlaceholder')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {query.trim().length < 2 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {t('minSearchLength')}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{t('noResults')}</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pick(r.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.projectKey}-{r.number}
                  </span>
                  <span className="flex-1 truncate">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
