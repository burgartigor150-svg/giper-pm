'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  CalendarIcon,
  CalendarDays,
  CalendarRange,
  Filter,
  X,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { changeTaskDueDateAction } from '@/actions/calendar';

// ---------------- types ----------------

type Person = { id: string; name: string; image: string | null };

export type DeadlineItem = {
  id: string;
  number: number;
  title: string;
  dueDate: string; // ISO
  internalStatus: string;
  priority: string;
  projectKey: string;
  projectName: string;
  externalSource: string | null;
  assignee: Person | null;
};

type Filters = {
  scope?: 'mine' | 'team';
  projectKey?: string;
  assigneeId?: string;
  status?: string[];
};

type View = 'month' | 'week' | 'day';

type Props = {
  view: View;
  /** YYYY-MM-DD anchor for week/day view, YYYY-MM-01 for month view. */
  anchor: string;
  items: DeadlineItem[];
  lookahead: DeadlineItem[];
  currentUserId: string;
  currentUserRole: string;
  projects: { key: string; name: string }[];
  assignees: { id: string; name: string }[];
  initialFilters: Filters;
};

// ---------------- consts ----------------

const PRIORITY_BAR: Record<string, string> = {
  URGENT: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-blue-500',
  LOW: 'bg-slate-400',
};

const STATUS_BG: Record<string, string> = {
  BACKLOG: 'bg-slate-50 text-slate-700',
  TODO: 'bg-blue-50 text-blue-800',
  IN_PROGRESS: 'bg-amber-50 text-amber-800',
  REVIEW: 'bg-purple-50 text-purple-800',
  BLOCKED: 'bg-red-50 text-red-800',
  DONE: 'bg-emerald-50 text-emerald-800',
  CANCELED: 'bg-slate-50 text-slate-500 line-through',
};

const STATUS_RU: Record<string, string> = {
  BACKLOG: 'BACKLOG',
  TODO: 'К выполнению',
  IN_PROGRESS: 'Выполняется',
  REVIEW: 'На ревью',
  BLOCKED: 'Заблокировано',
  DONE: 'Готово',
  CANCELED: 'Отменено',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_LABEL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const CELL_VISIBLE_LIMIT = 8;

// ---------------- helpers ----------------

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtRange(view: View, anchor: string): string {
  if (view === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    return `${MONTH_LABEL[(m! - 1) | 0]} ${y}`;
  }
  if (view === 'week') {
    const start = new Date(anchor);
    const end = new Date(start.getTime() + 6 * 86400_000);
    const fmt = (d: Date) => `${d.getDate()} ${MONTH_LABEL[d.getMonth()]?.slice(0, 3)}`;
    return `${fmt(start)} – ${fmt(end)} ${start.getFullYear()}`;
  }
  const d = new Date(anchor);
  return `${d.getDate()} ${MONTH_LABEL[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------------- component ----------------

export function Calendar({
  view,
  anchor,
  items,
  lookahead,
  currentUserId,
  currentUserRole,
  projects,
  assignees,
  initialFilters,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [popover, setPopover] = useState<{ key: string; date: Date } | null>(null);
  const [optimisticMove, setOptimisticMove] = useState<Map<string, string>>(
    new Map(),
  );
  // Mouse + touch sensors instead of the unified PointerSensor — gives
  // us better cross-browser behaviour (Pointer events on Safari can be
  // squashed by parent elements with touch-action: pan-y, which the
  // calendar grid effectively has via the surrounding scroll container).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );
  const [activeDragItem, setActiveDragItem] = useState<DeadlineItem | null>(null);
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = dayKey(today);

  // Filters local state (drives URL on apply).
  const [filters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(
    !!(initialFilters.scope === 'team' ||
      initialFilters.projectKey ||
      initialFilters.assigneeId ||
      (initialFilters.status && initialFilters.status.length)),
  );
  const isPrivileged =
    currentUserRole === 'ADMIN' || currentUserRole === 'PM';

  // ---- Bucket items by day, applying any optimistic moves
  // (a drag-and-drop done on the client before the server roundtrip
  // returns a new SSR pass).
  const buckets = useMemo(() => {
    const map = new Map<string, DeadlineItem[]>();
    for (const it of items) {
      const movedTo = optimisticMove.get(it.id);
      const d = movedTo ? new Date(movedTo) : new Date(it.dueDate);
      const k = dayKey(d);
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    // Sort each day: priority desc, then status, then number.
    const PRIORITY_W: Record<string, number> = {
      URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
    };
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          (PRIORITY_W[b.priority] ?? 0) - (PRIORITY_W[a.priority] ?? 0) ||
          a.internalStatus.localeCompare(b.internalStatus) ||
          a.number - b.number,
      );
    }
    return map;
  }, [items, optimisticMove]);

  // ---- Navigation
  const navigate = useCallback(
    (delta: number) => {
      const sp = new URLSearchParams(params.toString());
      if (view === 'month') {
        const [y, m] = anchor.split('-').map(Number);
        const next = new Date(y!, (m! - 1) | 0 + delta, 1);
        sp.set('m', `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
        sp.delete('d');
      } else {
        const d = new Date(anchor);
        const step = view === 'week' ? 7 : 1;
        d.setDate(d.getDate() + delta * step);
        sp.set('d', ymd(d));
        sp.delete('m');
      }
      router.push(`?${sp.toString()}`);
    },
    [view, anchor, params, router],
  );
  const goToday = useCallback(() => {
    const sp = new URLSearchParams(params.toString());
    sp.delete('m');
    sp.delete('d');
    router.push(sp.toString() ? `?${sp.toString()}` : '?');
  }, [params, router]);

  // Jump to an arbitrary date picked in the toolbar. We always store
  // the picked day in `?d=YYYY-MM-DD` (so the day cell can render a
  // selection ring inside the current month) and additionally pin the
  // month anchor for month view via `?m`. For week/day view the `d`
  // param IS the anchor — same shape as the manual ←/→ navigation.
  const goToDate = useCallback(
    (iso: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      const sp = new URLSearchParams(params.toString());
      sp.set('d', iso);
      if (view === 'month') sp.set('m', iso.slice(0, 7));
      else sp.delete('m');
      router.push(`?${sp.toString()}`);
    },
    [view, params, router],
  );

  // Current anchor as YYYY-MM-DD for the <input type="date">. In
  // month view the server gives us YYYY-MM-01; pull the explicit
  // selected day from the URL `d=` if present so the picker reflects
  // the user's last choice instead of the 1st.
  const explicitDay = params.get('d') ?? '';
  const anchorIso = explicitDay && /^\d{4}-\d{2}-\d{2}$/.test(explicitDay)
    ? explicitDay
    : anchor;
  const selectedDayKey = explicitDay
    ? (() => {
        const d = new Date(explicitDay);
        return Number.isNaN(d.getTime()) ? null : dayKey(d);
      })()
    : null;
  const setView = useCallback(
    (next: View) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('v', next);
      // When switching, anchor today by default to avoid landing on
      // an empty week/day far away.
      sp.delete('m');
      sp.delete('d');
      router.push(`?${sp.toString()}`);
    },
    [params, router],
  );

  // ---- Filters → URL
  const applyFilters = useCallback(
    (next: Filters) => {
      const sp = new URLSearchParams(params.toString());
      if (next.scope === 'team') sp.set('scope', 'team');
      else sp.delete('scope');
      if (next.projectKey) sp.set('proj', next.projectKey);
      else sp.delete('proj');
      if (next.assigneeId) sp.set('ass', next.assigneeId);
      else sp.delete('ass');
      if (next.status && next.status.length) sp.set('st', next.status.join(','));
      else sp.delete('st');
      router.push(`?${sp.toString()}`);
    },
    [params, router],
  );

  // ---- Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        goToday();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, goToday]);

  // ---- DnD
  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveDragItem(items.find((it) => it.id === id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveDragItem(null);
    const activeId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith('day:')) return;
    const newDate = overId.slice('day:'.length); // YYYY-MM-DD
    const moved = items.find((it) => it.id === activeId);
    if (!moved) return;
    // Skip a no-op move (dropped on the same day).
    const sameDay = ymd(new Date(moved.dueDate)) === newDate;
    if (sameDay) return;
    // Optimistic move on the client.
    setOptimisticMove((prev) => {
      const next = new Map(prev);
      next.set(activeId, newDate);
      return next;
    });
    startTransition(async () => {
      const r = await changeTaskDueDateAction(activeId, newDate);
      if (!r.ok) {
        // Roll back on failure.
        setOptimisticMove((prev) => {
          const next = new Map(prev);
          next.delete(activeId);
          return next;
        });
        // eslint-disable-next-line no-alert
        alert(r.error.message);
      }
      router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-3">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{fmtRange(view, anchor)}</h1>
          <div className="flex flex-wrap items-center gap-1">
            {/* View switcher */}
            <div className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
              <ViewBtn active={view === 'month'} onClick={() => setView('month')}>
                <CalendarRange className="h-3.5 w-3.5" /> Месяц
              </ViewBtn>
              <ViewBtn active={view === 'week'} onClick={() => setView('week')}>
                <CalendarDays className="h-3.5 w-3.5" /> Неделя
              </ViewBtn>
              <ViewBtn active={view === 'day'} onClick={() => setView('day')}>
                <CalendarIcon className="h-3.5 w-3.5" /> День
              </ViewBtn>
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((s) => !s)}
              className={
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ' +
                (filtersOpen
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-input text-muted-foreground hover:bg-accent')
              }
            >
              <Filter className="h-3 w-3" /> Фильтры
            </button>
            <input
              type="date"
              value={anchorIso}
              onChange={(e) => goToDate(e.target.value)}
              title="Перейти к дате"
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <span className="ml-1 inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-md border border-input bg-background p-1.5 hover:bg-accent"
                aria-label="Назад"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goToday}
                className="rounded-md border border-input bg-background px-3 py-1 text-sm hover:bg-accent"
              >
                Сегодня
              </button>
              <button
                type="button"
                onClick={() => navigate(1)}
                className="rounded-md border border-input bg-background p-1.5 hover:bg-accent"
                aria-label="Вперёд"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          </div>
        </div>

        {/* Filters bar */}
        {filtersOpen ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
            {isPrivileged ? (
              <div className="inline-flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => applyFilters({ ...filters, scope: 'mine' })}
                  className={
                    'rounded px-2 py-0.5 ' +
                    (filters.scope !== 'team'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent')
                  }
                  title="Только мои задачи (по умолчанию)"
                >
                  Мои
                </button>
                <button
                  type="button"
                  onClick={() => applyFilters({ ...filters, scope: 'team' })}
                  className={
                    'rounded px-2 py-0.5 ' +
                    (filters.scope === 'team'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent')
                  }
                  title="Все задачи команды (доступно ADMIN / PM)"
                >
                  Вся команда
                </button>
              </div>
            ) : null}
            <select
              value={filters.projectKey ?? ''}
              onChange={(e) =>
                applyFilters({ ...filters, projectKey: e.target.value || undefined })
              }
              className="rounded border border-input bg-background px-1.5 py-0.5"
            >
              <option value="">Все проекты</option>
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
            <select
              value={filters.assigneeId ?? ''}
              onChange={(e) =>
                applyFilters({ ...filters, assigneeId: e.target.value || undefined })
              }
              className="rounded border border-input bg-background px-1.5 py-0.5"
            >
              <option value="">Все исполнители</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">Статус:</span>
            {(['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'BACKLOG', 'DONE'] as const).map(
              (s) => {
                const active = filters.status?.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      const cur = new Set(filters.status ?? []);
                      if (active) cur.delete(s);
                      else cur.add(s);
                      applyFilters({ ...filters, status: [...cur] });
                    }}
                    className={
                      'rounded-full border px-2 py-0.5 ' +
                      (active
                        ? 'border-blue-300 bg-blue-100 text-blue-800'
                        : 'border-input text-muted-foreground hover:bg-accent')
                    }
                  >
                    {STATUS_RU[s] ?? s}
                  </button>
                );
              },
            )}
            {(filters.scope === 'team' ||
              filters.projectKey ||
              filters.assigneeId ||
              (filters.status && filters.status.length)) ? (
              <button
                type="button"
                onClick={() =>
                  applyFilters({
                    scope: 'mine',
                    projectKey: undefined,
                    assigneeId: undefined,
                    status: undefined,
                  })
                }
                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Сбросить
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Layout: grid + sidebar */}
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div>
            {view === 'month' ? (
              <MonthGrid
                anchor={anchor}
                today={today}
                selectedDayKey={selectedDayKey}
                buckets={buckets}
                onDayClick={(date) => setPopover({ key: dayKey(date), date })}
              />
            ) : view === 'week' ? (
              <WeekGrid
                anchor={anchor}
                today={today}
                selectedDayKey={selectedDayKey}
                buckets={buckets}
                onDayClick={(date) => setPopover({ key: dayKey(date), date })}
              />
            ) : (
              <DayList anchor={anchor} buckets={buckets} />
            )}
          </div>
          <UpcomingSidebar
            items={lookahead}
            currentUserId={currentUserId}
          />
        </div>

        {/* Day popover */}
        {popover ? (
          <DayPopover
            date={popover.date}
            items={buckets.get(popover.key) ?? []}
            onClose={() => setPopover(null)}
          />
        ) : null}

        {/* Footer hint */}
        <p className="text-[11px] text-muted-foreground">
          Перетащите задачу на другой день, чтобы изменить дедлайн (синхронизуется
          с Bitrix24). Стрелки ←/→ — переключение, T — сегодня.
        </p>
      </div>
      {/* Floating preview of the dragged card. Rendered in a portal at
          document level so the calendar grid's overflow:hidden doesn't
          clip the visual. Without this, the original card stays put
          and nothing appears to "move" — making DnD look broken. */}
      <DragOverlay dropAnimation={null}>
        {activeDragItem ? (
          <div className={cardClass(activeDragItem, false) + ' shadow-lg'}>
            <CardBody item={activeDragItem} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------- subcomponents ----------------

function ViewBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs ' +
        (active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-accent')
      }
    >
      {children}
    </button>
  );
}

function MonthGrid({
  anchor,
  today,
  selectedDayKey,
  buckets,
  onDayClick,
}: {
  anchor: string;
  today: Date;
  selectedDayKey: string | null;
  buckets: Map<string, DeadlineItem[]>;
  onDayClick: (d: Date) => void;
}) {
  const [y, m] = anchor.split('-').map(Number);
  const year = y!;
  const monthIdx = (m! - 1) | 0;
  const first = new Date(year, monthIdx, 1);
  const offset = (first.getDay() + 6) % 7;
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(year, monthIdx, 1 - offset + w * 7 + d));
    }
    weeks.push(row);
  }
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
      {WEEKDAYS.map((d) => (
        <div
          key={d}
          className="bg-muted px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {d}
        </div>
      ))}
      {weeks.flatMap((row) =>
        row.map((day) => (
          <DayCell
            key={ymd(day)}
            day={day}
            today={today}
            isSelected={dayKey(day) === selectedDayKey}
            inMonth={day.getMonth() === monthIdx}
            items={buckets.get(dayKey(day)) ?? []}
            onClick={onDayClick}
          />
        )),
      )}
    </div>
  );
}

function WeekGrid({
  anchor,
  today,
  selectedDayKey,
  buckets,
  onDayClick,
}: {
  anchor: string;
  today: Date;
  selectedDayKey: string | null;
  buckets: Map<string, DeadlineItem[]>;
  onDayClick: (d: Date) => void;
}) {
  const start = new Date(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
      {days.map((d, i) => (
        <div
          key={`h-${ymd(d)}`}
          className="bg-muted px-2 py-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {WEEKDAYS[i]}, {d.getDate()}.{String(d.getMonth() + 1).padStart(2, '0')}
        </div>
      ))}
      {days.map((d) => (
        <DayCell
          key={ymd(d)}
          day={d}
          today={today}
          isSelected={dayKey(d) === selectedDayKey}
          inMonth={true}
          items={buckets.get(dayKey(d)) ?? []}
          onClick={onDayClick}
          tall
        />
      ))}
    </div>
  );
}

function DayList({
  anchor,
  buckets,
}: {
  anchor: string;
  buckets: Map<string, DeadlineItem[]>;
}) {
  const d = new Date(anchor);
  const list = buckets.get(dayKey(d)) ?? [];
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <h2 className="mb-2 text-sm font-medium">
        {d.toLocaleDateString('ru-RU', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}
      </h2>
      <DroppableDay date={d}>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">На этот день задач нет.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((it) => (
              <DraggableTaskCard key={it.id} item={it} expanded />
            ))}
          </ul>
        )}
      </DroppableDay>
    </div>
  );
}

function DayCell({
  day,
  today,
  isSelected,
  inMonth,
  items,
  onClick,
  tall,
}: {
  day: Date;
  today: Date;
  isSelected: boolean;
  inMonth: boolean;
  items: DeadlineItem[];
  onClick: (d: Date) => void;
  tall?: boolean;
}) {
  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
  const overdueOpen =
    day < today && items.some((i) => i.internalStatus !== 'DONE' && i.internalStatus !== 'CANCELED');
  const isToday = isSameDay(day, today);

  const visible = items.slice(0, CELL_VISIBLE_LIMIT);
  const hidden = items.length - visible.length;

  return (
    <DroppableDay date={day} className="contents">
      <div
        className={[
          'flex flex-col gap-1 bg-background p-1.5',
          tall ? 'min-h-[280px]' : 'min-h-[120px]',
          inMonth ? '' : 'opacity-40',
          isWeekend ? 'bg-muted/40' : '',
          overdueOpen ? 'bg-red-50' : '',
          isToday ? 'ring-2 ring-blue-500 ring-inset' : '',
          isSelected && !isToday ? 'ring-2 ring-purple-500 ring-inset' : '',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={() => onClick(day)}
          className="flex items-center justify-between text-left"
        >
          <span
            className={[
              'text-[11px] font-mono',
              isToday ? 'font-semibold text-blue-700' : 'text-muted-foreground',
            ].join(' ')}
          >
            {day.getDate()}
          </span>
          {items.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px]">
              {items.length}
            </span>
          ) : null}
        </button>
        <div className="flex min-h-0 flex-col gap-0.5">
          {visible.map((it) => (
            <DraggableTaskCard key={it.id} item={it} />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => onClick(day)}
              className="px-1 text-left text-[10px] text-muted-foreground hover:underline"
            >
              +{hidden} ещё
            </button>
          ) : null}
        </div>
      </div>
    </DroppableDay>
  );
}

function DroppableDay({
  date,
  children,
  className,
}: {
  date: Date;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${ymd(date)}` });
  return (
    <div
      ref={setNodeRef}
      className={[className, isOver ? 'outline outline-2 outline-blue-400' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

function DraggableTaskCard({
  item,
  expanded,
}: {
  item: DeadlineItem;
  expanded?: boolean;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
  });
  // Track whether the pointer has actually moved past the activation
  // distance — `isDragging` only flips when dnd-kit fires its onDragStart,
  // and we need to suppress the click that would otherwise navigate.
  const draggedSinceDownRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedSinceDownRef.current = true;
  }, [isDragging]);
  const link = `/projects/${item.projectKey}/tasks/${item.number}`;
  const title = `${item.projectKey}-${item.number} · ${item.title}${
    item.assignee ? ` · ${item.assignee.name}` : ''
  }`;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="link"
      tabIndex={0}
      title={title}
      // While the user actually drags, hide the original card — the
      // DragOverlay portal renders a floating copy at document level
      // (escapes the calendar grid's overflow:hidden clipping).
      style={isDragging ? { opacity: 0 } : undefined}
      // Don't render a real <a>/<Link> — Chrome/Safari treat anchors
      // as native HTML5 drag sources, which races dnd-kit's pointer
      // sensor and aborts the drag entirely. Manual click → router.push
      // gives us reliable DnD plus normal click-to-open behaviour.
      onPointerDown={() => {
        draggedSinceDownRef.current = false;
      }}
      onClick={(e) => {
        if (draggedSinceDownRef.current) {
          draggedSinceDownRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.metaKey || e.ctrlKey || e.button === 1) {
          window.open(link, '_blank', 'noopener,noreferrer');
          return;
        }
        router.push(link);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(link);
        }
      }}
      className={cardClass(item, expanded)}
    >
      <CardBody item={item} expanded={expanded} />
    </div>
  );
}

function cardClass(item: DeadlineItem, expanded: boolean | undefined): string {
  const bg = STATUS_BG[item.internalStatus] ?? 'bg-muted';
  return [
    'cursor-grab select-none touch-none active:cursor-grabbing',
    'flex items-center gap-1 overflow-hidden rounded-sm pl-0 pr-1 py-0.5 text-[10px]',
    'hover:underline',
    bg,
    expanded ? 'p-1 text-xs' : '',
  ].join(' ');
}

function CardBody({
  item,
  expanded,
}: {
  item: DeadlineItem;
  expanded?: boolean;
}) {
  const bar = PRIORITY_BAR[item.priority] ?? 'bg-slate-400';
  return (
    <>
      <span className={`h-full w-1 shrink-0 self-stretch ${bar}`} />
      <span className="flex-1 truncate">
        {item.projectKey}-{item.number} {item.title}
      </span>
      {item.assignee && expanded ? (
        <span className="shrink-0 truncate text-muted-foreground">
          {item.assignee.name}
        </span>
      ) : null}
    </>
  );
}

function DayPopover({
  date,
  items,
  onClose,
}: {
  date: Date;
  items: DeadlineItem[];
  onClose: () => void;
}) {
  const dateStr = date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h3 className="text-sm font-medium">{dateStr}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Задач на этот день нет.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/projects/${it.projectKey}/tasks/${it.number}`}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span
                      className={`h-7 w-1 shrink-0 rounded ${
                        PRIORITY_BAR[it.priority] ?? 'bg-slate-400'
                      }`}
                    />
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        STATUS_BG[it.internalStatus] ?? 'bg-muted'
                      }`}
                    >
                      {STATUS_RU[it.internalStatus] ?? it.internalStatus}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {it.projectKey}-{it.number}
                    </span>
                    <span className="flex-1 truncate">{it.title}</span>
                    {it.assignee ? (
                      <span className="text-xs text-muted-foreground">
                        {it.assignee.name}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-4 py-2 text-right">
          <Link
            href={`/projects?dueDate=${ymd(date)}`}
            className="text-xs text-blue-700 hover:underline"
          >
            + Создать задачу с этим дедлайном
          </Link>
        </div>
      </div>
    </div>
  );
}

function UpcomingSidebar({
  items,
  currentUserId,
}: {
  items: DeadlineItem[];
  currentUserId: string;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const groups = useMemo(() => {
    const map = new Map<string, DeadlineItem[]>();
    for (const it of items) {
      const k = ymd(new Date(it.dueDate));
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <aside className="rounded-md border border-border bg-background p-3 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ближайшие 14 дней
      </h2>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Открытых задач с дедлайнами в ближайшие 2 недели нет.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map(([key, list]) => {
            const d = new Date(key);
            const isToday = isSameDay(d, today);
            const isOverdue = d < today;
            const dayLabel = isToday
              ? 'Сегодня'
              : isOverdue
                ? 'Просрочено'
                : d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' });
            return (
              <li key={key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-[11px] uppercase">
                  <span className={isToday ? 'font-semibold text-blue-700' : 'text-muted-foreground'}>
                    {dayLabel}
                  </span>
                  <span className="text-muted-foreground">{list.length}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {list.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/projects/${it.projectKey}/tasks/${it.number}`}
                        className="flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-accent"
                      >
                        <span
                          className={`h-4 w-1 shrink-0 rounded ${PRIORITY_BAR[it.priority] ?? 'bg-slate-400'}`}
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {it.projectKey}-{it.number}
                        </span>
                        <span
                          className={
                            'flex-1 truncate ' +
                            (it.assignee?.id === currentUserId
                              ? 'font-medium'
                              : '')
                          }
                        >
                          {it.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
