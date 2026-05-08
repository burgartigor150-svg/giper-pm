'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

type DeadlineItem = {
  id: string;
  number: number;
  title: string;
  dueDate: string; // ISO from server
  internalStatus: string;
  priority: string;
  projectKey: string;
  assignee: { id: string; name: string; image: string | null } | null;
};

type Props = {
  /** YYYY-MM-01 of the displayed month, in user's local timezone. */
  monthStart: string;
  items: DeadlineItem[];
};

const STATUS_COLOUR: Record<string, string> = {
  BACKLOG: 'bg-slate-200 text-slate-800',
  TODO: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  REVIEW: 'bg-purple-100 text-purple-800',
  BLOCKED: 'bg-red-100 text-red-800',
  DONE: 'bg-emerald-100 text-emerald-800',
  CANCELED: 'bg-slate-100 text-slate-500 line-through',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MONTH_LABEL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/**
 * Month grid. Cells are days; each cell lists tasks whose dueDate falls
 * on that day. Today's cell is ringed; weekends shaded; overdue
 * (open task with dueDate < today) cell highlighted red.
 */
export function CalendarMonth({ monthStart, items }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, setPending] = useState(false);

  const { weeks, year, monthIdx, todayKey } = useMemo(() => {
    const [y, m] = monthStart.split('-').map(Number);
    const year = y!;
    const monthIdx = (m! - 1) | 0;
    const first = new Date(year, monthIdx, 1);
    // Start of the calendar grid: Monday on or before the 1st.
    const offset = (first.getDay() + 6) % 7; // 0 = Mon
    const gridStart = new Date(year, monthIdx, 1 - offset);
    const weeks: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(new Date(year, monthIdx, 1 - offset + w * 7 + d));
      }
      weeks.push(row);
    }
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    return { weeks, year, monthIdx, todayKey };
  }, [monthStart]);

  // Bucket items by yyyy-m-d for O(1) lookup per cell.
  const buckets = useMemo(() => {
    const map = new Map<string, DeadlineItem[]>();
    for (const it of items) {
      const d = new Date(it.dueDate);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    return map;
  }, [items]);

  function navigate(delta: number) {
    setPending(true);
    const next = new Date(year, monthIdx + delta, 1);
    const param = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const sp = new URLSearchParams(params.toString());
    sp.set('m', param);
    router.push(`?${sp.toString()}`);
  }

  function isOpen(it: DeadlineItem): boolean {
    return it.internalStatus !== 'DONE' && it.internalStatus !== 'CANCELED';
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {MONTH_LABEL[monthIdx]} {year}
        </h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-input bg-background p-1.5 hover:bg-accent"
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const sp = new URLSearchParams(params.toString());
              sp.delete('m');
              router.push(sp.toString() ? `?${sp.toString()}` : '?');
            }}
            className="rounded-md border border-input bg-background px-3 py-1 text-sm hover:bg-accent"
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="rounded-md border border-input bg-background p-1.5 hover:bg-accent"
            aria-label="Следующий месяц"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="bg-muted px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {weeks.map((row, wi) =>
          row.map((day) => {
            const inMonth = day.getMonth() === monthIdx;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayItems = buckets.get(key) ?? [];
            const hasOverdueOpen =
              day < new Date(new Date().setHours(0, 0, 0, 0)) &&
              dayItems.some(isOpen);
            return (
              <div
                key={`${wi}-${key}`}
                className={[
                  'min-h-[110px] flex flex-col gap-1 bg-background p-1.5',
                  inMonth ? '' : 'opacity-40',
                  isWeekend ? 'bg-muted/40' : '',
                  hasOverdueOpen ? 'bg-red-50' : '',
                  todayKey === key ? 'ring-2 ring-blue-500 ring-inset' : '',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      'text-[11px] font-mono',
                      todayKey === key ? 'font-semibold text-blue-700' : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </span>
                  {dayItems.length > 0 ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px]">
                      {dayItems.length}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayItems.slice(0, 4).map((it) => (
                    <Link
                      key={it.id}
                      href={`/projects/${it.projectKey}/tasks/${it.number}`}
                      className={[
                        'truncate rounded px-1 py-0.5 text-[10px] hover:underline',
                        STATUS_COLOUR[it.internalStatus] ?? 'bg-muted',
                      ].join(' ')}
                      title={`${it.projectKey}-${it.number} · ${it.title}${
                        it.assignee ? ` · ${it.assignee.name}` : ''
                      }`}
                    >
                      {it.projectKey}-{it.number} {it.title}
                    </Link>
                  ))}
                  {dayItems.length > 4 ? (
                    <span className="px-1 text-[9px] text-muted-foreground">
                      +{dayItems.length - 4} ещё
                    </span>
                  ) : null}
                </div>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
