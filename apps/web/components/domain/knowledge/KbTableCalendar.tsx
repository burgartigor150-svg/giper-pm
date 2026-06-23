'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { KbColumn, KbRow } from '@/lib/knowledge/getTables';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Month calendar placing rows on the day of their DATE column (read-only v1). */
export function KbTableCalendar({
  columns,
  rows,
  dateColId,
}: {
  columns: KbColumn[];
  rows: KbRow[];
  dateColId: string;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const labelCol = columns[0];

  // rows grouped by 'YYYY-MM-DD'
  const byDay = useMemo(() => {
    const map = new Map<string, KbRow[]>();
    for (const r of rows) {
      const d = (r.values[dateColId] ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const arr = map.get(d) ?? [];
      arr.push(r);
      map.set(d, arr);
    }
    return map;
  }, [rows, dateColId]);

  const firstOfMonth = new Date(year, month, 1);
  // JS getDay: 0=Sun..6=Sat → convert to Mon-first offset 0..6
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function shift(delta: number) {
    const m = month + delta;
    if (m < 0) { setMonth(11); setYear((y) => y - 1); }
    else if (m > 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth(m);
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => shift(-1)} className="rounded border border-neutral-300 p-1 dark:border-neutral-700" aria-label="Предыдущий месяц">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => shift(1)} className="rounded border border-neutral-300 p-1 dark:border-neutral-700" aria-label="Следующий месяц">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 text-sm dark:border-neutral-800 dark:bg-neutral-800">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-muted px-2 py-1 text-center text-xs font-semibold text-muted-foreground">{w}</div>
        ))}
        {cells.map((day, i) => {
          const key = day ? `${year}-${pad(month + 1)}-${pad(day)}` : null;
          const dayRows = key ? byDay.get(key) ?? [] : [];
          return (
            <div key={i} className="min-h-[84px] bg-background p-1 align-top">
              {day ? <div className="mb-1 text-xs text-muted-foreground">{day}</div> : null}
              <div className="flex flex-col gap-1">
                {dayRows.map((r) => (
                  <div key={r.id} className="truncate rounded bg-blue-50 px-1 py-0.5 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" title={(labelCol && r.values[labelCol.id]) || ''}>
                    {(labelCol && r.values[labelCol.id]) || 'Без названия'}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
