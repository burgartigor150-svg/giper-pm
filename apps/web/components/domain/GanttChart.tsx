'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { cn } from '@giper/ui/cn';
import type { GanttTask } from '@/lib/gantt/getGanttData';

const STATUS_BAR: Record<GanttTask['status'], string> = {
  BACKLOG: 'bg-slate-400',
  TODO: 'bg-sky-500',
  IN_PROGRESS: 'bg-blue-500',
  REVIEW: 'bg-amber-500',
  BLOCKED: 'bg-red-500',
  DONE: 'bg-emerald-500',
  CANCELED: 'bg-neutral-300',
};

const DAY = 86_400_000;
const ROW = 'h-7';

export function GanttChart({ projectKey, tasks }: { projectKey: string; tasks: GanttTask[] }) {
  const model = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      min = Math.min(min, new Date(t.start).getTime());
      max = Math.max(max, new Date(t.end).getTime());
    }
    min -= 3 * DAY;
    max += 3 * DAY;
    if (max - min < 7 * DAY) max = min + 7 * DAY;
    const span = max - min;

    const ticks: { left: number; label: string }[] = [];
    const first = new Date(min);
    first.setUTCHours(0, 0, 0, 0);
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7)); // back to Monday
    for (let d = first.getTime(); d <= max; d += 7 * DAY) {
      if (d < min) continue;
      ticks.push({
        left: ((d - min) / span) * 100,
        label: new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      });
    }
    const todayLeft = ((Date.now() - min) / span) * 100;
    return { min, span, ticks, todayLeft };
  }, [tasks]);

  if (!model) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет задач с датами для таймлайна.
      </p>
    );
  }

  const pct = (iso: string) => ((new Date(iso).getTime() - model.min) / model.span) * 100;

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[760px]">
        {/* Label column */}
        <div className="w-56 shrink-0">
          <div className="mb-1 h-5 border-b" />
          {tasks.map((t) => (
            <Link
              key={t.number}
              href={`/projects/${projectKey}/tasks/${t.number}`}
              className={cn('flex items-center truncate pr-2 text-xs hover:underline', ROW)}
              title={t.title}
            >
              <span className="truncate">
                <span className="font-mono text-muted-foreground">
                  {projectKey}-{t.number}
                </span>{' '}
                {t.title}
              </span>
            </Link>
          ))}
        </div>

        {/* Track column */}
        <div className="relative flex-1">
          {/* Axis */}
          <div className="relative mb-1 h-5 border-b text-[10px] text-muted-foreground">
            {model.ticks.map((tk, i) => (
              <span key={i} className="absolute -translate-x-1/2" style={{ left: `${tk.left}%` }}>
                {tk.label}
              </span>
            ))}
          </div>

          {/* Weekly gridlines */}
          {model.ticks.map((tk, i) => (
            <div
              key={i}
              className="pointer-events-none absolute bottom-0 top-6 w-px bg-border/60"
              style={{ left: `${tk.left}%` }}
              aria-hidden
            />
          ))}
          {/* Today line */}
          {model.todayLeft >= 0 && model.todayLeft <= 100 ? (
            <div
              className="pointer-events-none absolute bottom-0 top-6 z-10 w-px bg-rose-500/80"
              style={{ left: `${model.todayLeft}%` }}
              aria-hidden
            />
          ) : null}

          {tasks.map((t) => {
            const left = Math.max(0, pct(t.start));
            const right = Math.min(100, pct(t.end));
            const width = Math.max(1.5, right - left);
            return (
              <div key={t.number} className={cn('relative border-b border-border/40', ROW)}>
                <div
                  className={cn(
                    'absolute top-1.5 h-4 rounded-sm',
                    STATUS_BAR[t.status],
                    t.overdue ? 'ring-2 ring-rose-500' : '',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${t.title}${t.assignee ? ` · ${t.assignee.name}` : ''}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" /> в работе</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> на ревью</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> готово</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm ring-2 ring-rose-500" /> просрочено</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-px bg-rose-500" /> сегодня</span>
      </div>
    </div>
  );
}
