'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@giper/ui/cn';
import type { GanttTask, GanttDep } from '@/lib/gantt/getGanttData';

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
// Pixel geometry matching the Tailwind classes below — used to align the
// dependency-arrow SVG overlay with the bars.
const HEADER_PX = 24; // axis row: h-5 (20) + mb-1 (4)
const ROW_PX = 28; // ROW = h-7
const BAR_CENTER_PX = 14; // bar: top-1.5 (6) + h-4/2 (8)

export function GanttChart({
  projectKey,
  tasks,
  deps = [],
}: {
  projectKey: string;
  tasks: GanttTask[];
  deps?: GanttDep[];
}) {
  // Measure the track column's pixel width so arrow x-coords (derived from
  // the same percent positions as the bars) land exactly on the bar edges.
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setTrackWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        <div className="relative flex-1" ref={trackRef}>
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

          {/* Dependency arrows (blocker → blocked). Drawn in an SVG overlay
              once the track's pixel width is known, so the percent-based bar
              positions map to exact pixel endpoints. */}
          {trackWidth > 0 && deps.length > 0
            ? (() => {
                const idx = new Map(tasks.map((t, i) => [t.id, i]));
                const byId = new Map(tasks.map((t) => [t.id, t]));
                const segs = deps.flatMap((dep, k) => {
                  const from = byId.get(dep.from);
                  const to = byId.get(dep.to);
                  const fi = idx.get(dep.from);
                  const ti = idx.get(dep.to);
                  if (!from || !to || fi === undefined || ti === undefined) return [];
                  const x1 =
                    (Math.min(100, Math.max(0, pct(from.end))) / 100) * trackWidth;
                  const y1 = HEADER_PX + fi * ROW_PX + BAR_CENTER_PX;
                  const x2 =
                    (Math.min(100, Math.max(0, pct(to.start))) / 100) * trackWidth;
                  const y2 = HEADER_PX + ti * ROW_PX + BAR_CENTER_PX;
                  const cdx = Math.max(12, Math.abs(x2 - x1) / 3);
                  return [
                    {
                      key: `${dep.from}-${dep.to}-${k}`,
                      d: `M ${x1} ${y1} C ${x1 + cdx} ${y1}, ${x2 - cdx} ${y2}, ${x2} ${y2}`,
                    },
                  ];
                });
                if (segs.length === 0) return null;
                return (
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-20 overflow-visible"
                    width={trackWidth}
                    height={HEADER_PX + tasks.length * ROW_PX}
                    aria-hidden
                  >
                    <defs>
                      <marker
                        id="gantt-arrow"
                        markerWidth="6"
                        markerHeight="6"
                        refX="5"
                        refY="3"
                        orient="auto"
                      >
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground/70" />
                      </marker>
                    </defs>
                    {segs.map((s) => (
                      <path
                        key={s.key}
                        d={s.d}
                        fill="none"
                        className="stroke-muted-foreground/60"
                        strokeWidth={1.5}
                        markerEnd="url(#gantt-arrow)"
                      />
                    ))}
                  </svg>
                );
              })()
            : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" /> в работе</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> на ревью</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> готово</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm ring-2 ring-rose-500" /> просрочено</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-px bg-rose-500" /> сегодня</span>
        <span className="inline-flex items-center gap-1"><span className="text-muted-foreground/70">→</span> зависимость (блокирует → зависит)</span>
      </div>
    </div>
  );
}
