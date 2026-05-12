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
  MeasuringStrategy,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { changeTaskDueDateAction } from '@/actions/calendar';
import { PriorityBadge } from '@/components/domain/PriorityBadge';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';

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

export type CalendarEventItem = {
  id: string;
  title: string;
  startAt: string; // ISO
  endAt: string; // ISO
  isAllDay: boolean;
  /** "meeting:<id>" marker for call-type events, otherwise location text. */
  location: string | null;
  createdById: string;
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
  events?: CalendarEventItem[];
  currentUserId: string;
  currentUserRole: string;
  projects: { key: string; name: string }[];
  assignees: { id: string; name: string }[];
  initialFilters: Filters;
};

// ---------------- consts ----------------

// Priority bar color — MASTER.md §1 priority table. Color is paired
// with a PriorityBadge icon at the visible-row level, so the bar alone
// never carries the signal.
const PRIORITY_BAR: Record<string, string> = {
  URGENT: 'bg-destructive',
  HIGH: 'bg-amber-600 dark:bg-amber-500',
  MEDIUM: 'bg-foreground/40',
  LOW: 'bg-muted-foreground/40',
};

// Status labels for the filter chip row only. Inline pills inside
// cells/popover use <TaskStatusBadge /> from the design system so
// the palette + icons stay consistent with the rest of the app.
const STATUS_RU: Record<string, string> = {
  BACKLOG: 'Бэклог',
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

/** Month/week cells are tight; prefer pointer, then rect overlap with day droppables. */
const calendarCollisionDetection: CollisionDetection = (args) => {
  const isDay = (id: UniqueIdentifier) => String(id).startsWith('day:');
  const byPointer = pointerWithin(args).filter((c) => isDay(c.id));
  if (byPointer.length) return byPointer;
  const byRect = rectIntersection(args).filter((c) => isDay(c.id));
  if (byRect.length) return byRect;
  return [];
};

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
  events = [],
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
  // Inline error banner for failed DnD moves — replaces window.alert()
  // which steals focus and breaks the keyboard flow. Auto-clears after
  // 5s; aria-live="assertive" makes SR users hear it immediately.
  const [dndError, setDndError] = useState<string | null>(null);
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

  // Per-day buckets of CalendarEvent (separate map — the grid renders
  // them after tasks in each cell). All-day events span their full
  // range; for the calendar's simple use we drop a chip on every day
  // the event covers.
  const eventBuckets = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of events) {
      // Walk from startAt's day to the day before endAt (endAt is
      // exclusive for all-day; for timed events the same day usually).
      const start = startOfDay(new Date(ev.startAt));
      const end = new Date(ev.endAt);
      let cur = start;
      let safety = 0;
      while (cur.getTime() < end.getTime() && safety < 60) {
        const k = dayKey(cur);
        const arr = map.get(k);
        if (arr) arr.push(ev);
        else map.set(k, [ev]);
        cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
        safety++;
      }
    }
    return map;
  }, [events]);

  // ---- Navigation
  const navigate = useCallback(
    (delta: number) => {
      const sp = new URLSearchParams(params.toString());
      if (view === 'month') {
        const [y, m] = anchor.split('-').map(Number);
        // Bitwise `|` has lower precedence than `+`, so the previous
        // `(m! - 1) | 0 + delta` parsed as `(m-1) | delta` — a bitwise
        // OR that for delta=-1 produced -1 (jump a year) and for
        // delta=+1 left the month unchanged. Plain arithmetic + Date
        // handles month rollover for us.
        const next = new Date(y!, m! - 1 + delta, 1);
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
  function onDragCancel() {
    setActiveDragItem(null);
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
        setDndError(r.error.message);
        // Auto-clear after 5s.
        setTimeout(() => setDndError(null), 5000);
      }
      // scroll: false preserves the user's position when the route
      // server-renders the new task data.
      router.refresh();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={calendarCollisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      <div className="flex flex-col gap-4">
        {/* Inline error region for DnD failures. role=alert + aria-live
            so screen readers announce immediately. Visible but
            inline — no focus steal. */}
        {dndError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {dndError}
          </div>
        ) : null}
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold md:text-2xl">{fmtRange(view, anchor)}</h1>
          <div className="flex flex-wrap items-center gap-1">
            {/* View switcher — labels hide on mobile to fit. */}
            <div className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
              <ViewBtn active={view === 'month'} onClick={() => setView('month')}>
                <CalendarRange className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Месяц</span>
              </ViewBtn>
              <ViewBtn active={view === 'week'} onClick={() => setView('week')}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Неделя</span>
              </ViewBtn>
              <ViewBtn active={view === 'day'} onClick={() => setView('day')}>
                <CalendarIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">День</span>
              </ViewBtn>
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((s) => !s)}
              aria-expanded={filtersOpen}
              aria-controls="calendar-filters"
              className={
                'inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
                (filtersOpen
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input text-muted-foreground hover:bg-muted')
              }
            >
              <Filter className="size-3.5" />
              <span className="hidden sm:inline">Фильтры</span>
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
                      'rounded-full border px-2 py-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
                      (active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-input text-muted-foreground hover:bg-muted')
                    }
                    aria-pressed={active}
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
                eventBuckets={eventBuckets}
                onDayClick={(date) => setPopover({ key: dayKey(date), date })}
              />
            ) : view === 'week' ? (
              <WeekGrid
                anchor={anchor}
                today={today}
                selectedDayKey={selectedDayKey}
                buckets={buckets}
                eventBuckets={eventBuckets}
                onDayClick={(date) => setPopover({ key: dayKey(date), date })}
              />
            ) : (
              <DayList
                anchor={anchor}
                buckets={buckets}
                events={eventBuckets.get(anchor) ?? []}
              />
            )}
          </div>
          <div className="hidden lg:block">
            <UpcomingSidebar
              items={lookahead}
              currentUserId={currentUserId}
            />
          </div>
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
        <p className="text-xs text-muted-foreground">
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
  eventBuckets,
  onDayClick,
}: {
  anchor: string;
  today: Date;
  selectedDayKey: string | null;
  buckets: Map<string, DeadlineItem[]>;
  eventBuckets: Map<string, CalendarEventItem[]>;
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
    <div className="touch-none grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
      {WEEKDAYS.map((d) => (
        <div
          key={d}
          className="bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
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
            events={eventBuckets.get(dayKey(day)) ?? []}
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
  eventBuckets,
  onDayClick,
}: {
  anchor: string;
  today: Date;
  selectedDayKey: string | null;
  buckets: Map<string, DeadlineItem[]>;
  eventBuckets: Map<string, CalendarEventItem[]>;
  onDayClick: (d: Date) => void;
}) {
  const start = new Date(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return (
    <div className="touch-none grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
      {days.map((d, i) => (
        <div
          key={`h-${ymd(d)}`}
          className="bg-muted px-1 py-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:px-2 md:text-xs"
        >
          <span className="md:hidden">{WEEKDAYS[i]} {d.getDate()}</span>
          <span className="hidden md:inline">
            {WEEKDAYS[i]}, {d.getDate()}.{String(d.getMonth() + 1).padStart(2, '0')}
          </span>
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
          events={eventBuckets.get(dayKey(d)) ?? []}
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
  events = [],
}: {
  anchor: string;
  buckets: Map<string, DeadlineItem[]>;
  events?: CalendarEventItem[];
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
        {list.length === 0 && events.length === 0 ? (
          <p className="text-sm text-muted-foreground">На этот день ничего нет.</p>
        ) : (
          <>
            {list.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {list.map((it) => (
                  <DraggableTaskCard key={it.id} item={it} expanded />
                ))}
              </ul>
            ) : null}
            {events.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <EventChip ev={ev} />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
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
  events = [],
  onClick,
  tall,
}: {
  day: Date;
  today: Date;
  isSelected: boolean;
  inMonth: boolean;
  items: DeadlineItem[];
  events?: CalendarEventItem[];
  onClick: (d: Date) => void;
  tall?: boolean;
}) {
  // Droppable must wrap a real layout box. Using `display: contents` on the
  // droppable wrapper (old pattern) yields a zero-sized rect in browsers, so
  // @dnd-kit never reports `over` on drag end — deadlines never persist.
  const { setNodeRef, isOver } = useDroppable({ id: `day:${ymd(day)}` });
  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
  const overdueOpen =
    day < today && items.some((i) => i.internalStatus !== 'DONE' && i.internalStatus !== 'CANCELED');
  const isToday = isSameDay(day, today);

  const visible = items.slice(0, CELL_VISIBLE_LIMIT);
  const hidden = items.length - visible.length;

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col gap-1 bg-background p-1 md:p-1.5',
        tall ? 'min-h-[200px] md:min-h-[280px]' : 'min-h-[64px] md:min-h-[120px]',
        inMonth ? '' : 'opacity-40',
        isWeekend ? 'bg-muted/40' : '',
        overdueOpen ? 'bg-destructive/10' : '',
        // Today + selected + drop-target are signalled via inset rings.
        // Color is paired with text-weight on the day number (today is
        // bold) so the signal isn't color-only (MASTER §10/§11).
        isToday ? 'ring-2 ring-foreground ring-inset' : '',
        isSelected && !isToday ? 'ring-2 ring-ring ring-inset' : '',
        isOver ? 'outline outline-2 outline-foreground outline-offset-[-2px]' : '',
      ].join(' ')}
      aria-current={isToday ? 'date' : undefined}
    >
      <button
        type="button"
        onClick={() => onClick(day)}
        className="flex items-center justify-between text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={[
            'text-xs font-mono tabular-nums',
            isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
          ].join(' ')}
        >
          {day.getDate()}
        </span>
        {items.length > 0 ? (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        ) : null}
      </button>
      {/* Compact mobile view: just colored priority dots for tasks +
          a tiny chip count for events. Tapping the day opens the
          full popover with the real list. */}
      <div className="flex flex-wrap gap-0.5 md:hidden">
        {items.slice(0, 6).map((it) => (
          <span
            key={it.id}
            className={[
              'h-1.5 w-1.5 rounded-full',
              PRIORITY_BAR[it.priority] ?? 'bg-muted-foreground/40',
            ].join(' ')}
            aria-hidden
          />
        ))}
        {events.length > 0 ? (
          <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        ) : null}
      </div>
      <div className="hidden min-h-0 flex-col gap-0.5 md:flex">
        {visible.map((it) => (
          <DraggableTaskCard key={it.id} item={it} />
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => onClick(day)}
            className="px-1 text-left text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            +{hidden} ещё
          </button>
        ) : null}
        {events.length > 0 ? (
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {events.slice(0, 3).map((ev) => (
              <EventChip key={ev.id} ev={ev} />
            ))}
            {events.length > 3 ? (
              <li className="px-1 text-[10px] text-muted-foreground">
                +{events.length - 3} ещё
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function EventChip({ ev }: { ev: CalendarEventItem }) {
  const isCall = !!ev.location && ev.location.startsWith('meeting:');
  const time = ev.isAllDay
    ? null
    : new Date(ev.startAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
  return (
    <div
      className={[
        'flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px]',
        isCall
          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      ].join(' ')}
      title={ev.title}
    >
      {time ? <span className="font-mono tabular-nums">{time}</span> : null}
      <span className="truncate">{ev.title}</span>
    </div>
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
      className={[className, isOver ? 'outline outline-2 outline-foreground' : '']
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

// Card in the month/week grid. Neutral background by design — the
// calendar gets very busy with 5+ cards per day, so we don't paint
// each card with its status color (that's MASTER §11 "noise on
// data-dense screens"). Status lives in the popover. Priority is
// shown as a 2px left bar PLUS a Lucide icon for non-MEDIUM (color
// alone is forbidden by MASTER §10/§11).
function cardClass(item: DeadlineItem, expanded: boolean | undefined): string {
  return [
    'cursor-grab select-none touch-none active:cursor-grabbing',
    'flex items-center gap-1 overflow-hidden rounded-sm pl-0 pr-1.5 py-0.5 text-xs',
    'bg-muted/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150',
    item.internalStatus === 'DONE' ? 'opacity-60' : '',
    item.internalStatus === 'CANCELED' ? 'opacity-50 line-through' : '',
    expanded ? 'py-1' : '',
  ].join(' ');
}

function CardBody({
  item,
  expanded,
}: {
  item: DeadlineItem;
  expanded?: boolean;
}) {
  const bar = PRIORITY_BAR[item.priority] ?? 'bg-muted-foreground/40';
  const showPriorityIcon =
    item.priority === 'URGENT' || item.priority === 'HIGH';
  return (
    <>
      <span className={`h-full w-1 shrink-0 self-stretch ${bar}`} aria-hidden="true" />
      {showPriorityIcon ? (
        <PriorityBadge
          priority={item.priority as 'URGENT' | 'HIGH'}
          iconOnly
        />
      ) : null}
      <span className="flex-1 truncate">
        <span className="font-mono text-muted-foreground tabular-nums">
          {item.projectKey}-{item.number}
        </span>{' '}
        {item.title}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dateStr}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-background shadow-lg"
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
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-7 w-1 shrink-0 rounded ${
                        PRIORITY_BAR[it.priority] ?? 'bg-muted-foreground/40'
                      }`}
                    />
                    <TaskStatusBadge status={it.internalStatus as Parameters<typeof TaskStatusBadge>[0]['status']} />
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
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
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2">
          <span className="mr-auto text-xs text-muted-foreground">Добавить:</span>
          <button
            type="button"
            onClick={() => {
              const dueDate = ymd(date);
              window.dispatchEvent(
                new CustomEvent('giper:quick-add-task', { detail: { dueDate } }),
              );
              onClose();
            }}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Задача
          </button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('giper:new-calendar-entry', {
                  detail: { date: ymd(date), mode: 'event' },
                }),
              );
              onClose();
            }}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Событие
          </button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('giper:new-calendar-entry', {
                  detail: { date: ymd(date), mode: 'call' },
                }),
              );
              onClose();
            }}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Созвон
          </button>
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
                <div className="flex items-baseline justify-between text-xs uppercase">
                  <span className={isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
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
                          aria-hidden="true"
                          className={`h-4 w-1 shrink-0 rounded ${PRIORITY_BAR[it.priority] ?? 'bg-muted-foreground/40'}`}
                        />
                        <span className="font-mono text-xs text-muted-foreground">
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
