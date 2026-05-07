import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import {
  getTodayTotals,
  getTodayTimeline,
  getTodayGaps,
  getUpcomingDeadlines,
} from '@/lib/dashboard';
import { getActiveTimer } from '@/lib/time';
import { formatMinutes, minutesToHours } from '@/lib/format/duration';
import { LiveDuration } from '@/components/domain/LiveDuration';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { AutoStoppedActions } from '@/components/domain/AutoStoppedActions';
import { LogGapButton } from '@/components/domain/LogGapButton';

/**
 * "Мой день" — single-page focus view for the working day. Different in
 * intent from /dashboard: dashboard is "overview / aggregates", this is
 * "what's in front of me right now".
 *
 * Three sections:
 *   1. Hero: live timer (if running) + today's total time.
 *   2. Today's timeline: chronological list of every time entry today,
 *      so the user can spot gaps ("I forgot to log 2-4 PM") at a glance.
 *      The "забыли списать" detector in Sprint 3 will plug into this.
 *   3. Upcoming deadlines: next 7 days, day-by-day, of tasks the user is
 *      assigned to. Overdue tasks pinned at the top in red.
 */
export default async function MyDayPage() {
  const me = await requireAuth();
  const [active, totals, timeline, gaps, deadlines] = await Promise.all([
    getActiveTimer(me.id),
    getTodayTotals(me.id),
    getTodayTimeline(me.id),
    getTodayGaps(me.id),
    getUpcomingDeadlines(me.id),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Мой день</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Hero: active timer + today total */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Сейчас</CardTitle>
          </CardHeader>
          <CardContent>
            {active?.task ? (
              <Link
                href={`/projects/${active.task.project.key}/tasks/${active.task.number}`}
                className="block"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">
                    <LiveDuration startedAt={active.startedAt} />
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {active.task.project.key}-{active.task.number}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  {active.task.title}
                </div>
              </Link>
            ) : (
              <div>
                <div className="text-3xl font-semibold text-muted-foreground tabular-nums">
                  —
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Таймер не запущен. Нажмите T или ⌘K, чтобы начать.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Сегодня всего</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {minutesToHours(totals.totalMin)} ч
            </div>
            {totals.perProject.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {totals.perProject.slice(0, 5).map((p) => (
                  <li key={p.key} className="flex items-baseline justify-between text-xs">
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-muted-foreground">
                      {formatMinutes(p.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Записей пока нет.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Today's timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Хронология дня</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока пусто. Запустите таймер на задаче — записи появятся здесь.
            </p>
          ) : (
            <ul className="flex flex-col">
              {mergeTimelineWithGaps(timeline, gaps).map((item) =>
                item.kind === 'entry' ? (
                  <EntryRow key={`e-${item.entry.id}`} entry={item.entry} />
                ) : (
                  <GapRow key={`g-${item.from.toISOString()}`} gap={item} />
                ),
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Upcoming deadlines, grouped by day */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Дедлайны на 7 дней</CardTitle>
        </CardHeader>
        <CardContent>
          <DeadlinesByDay deadlines={deadlines} />
        </CardContent>
      </Card>
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

type Entry = Awaited<ReturnType<typeof getTodayTimeline>>[number];
type Gap = Awaited<ReturnType<typeof getTodayGaps>>[number];
type MergedItem = { kind: 'entry'; entry: Entry; at: Date } | (Gap & { kind: 'gap'; at: Date });

/**
 * Interleave time entries with gap rows in chronological order, so the
 * "забыли списать" prompts appear exactly where the missing time falls.
 */
function mergeTimelineWithGaps(entries: Entry[], gaps: Gap[]): MergedItem[] {
  const items: MergedItem[] = [
    ...entries.map((e): MergedItem => ({ kind: 'entry', entry: e, at: e.startedAt })),
    ...gaps.map((g): MergedItem => ({ ...g, kind: 'gap', at: g.from })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function EntryRow({ entry }: { entry: Entry }) {
  const minutes =
    entry.endedAt && entry.durationMin != null
      ? entry.durationMin
      : Math.max(
          0,
          Math.floor((Date.now() - entry.startedAt.getTime()) / 60_000),
        );
  const isLive = !entry.endedAt;
  return (
    <li className="flex items-baseline gap-3 border-b border-border/50 py-2 last:border-b-0">
      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatTime(entry.startedAt)}
      </span>
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums">
        {isLive ? (
          <span className="text-emerald-600">
            <LiveDuration startedAt={entry.startedAt} />
          </span>
        ) : (
          formatMinutes(minutes)
        )}
      </span>
      <div className="min-w-0 flex-1">
        {entry.task ? (
          <Link
            href={`/projects/${entry.task.project.key}/tasks/${entry.task.number}`}
            className="text-sm hover:underline"
            title={entry.task.title}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {entry.task.project.key}-{entry.task.number}
            </span>
            <span className="ml-2">{entry.task.title}</span>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Без задачи</span>
        )}
        {entry.note ? (
          <div className="text-xs text-muted-foreground">{entry.note}</div>
        ) : null}
        {entry.flag === 'AUTO_STOPPED' ? (
          <AutoStoppedActions entryId={entry.id} durationMin={minutes} />
        ) : null}
      </div>
    </li>
  );
}

function GapRow({ gap }: { gap: Gap }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-amber-200/60 bg-amber-50/40 py-2 last:border-b-0">
      <span className="w-12 shrink-0 font-mono text-xs text-amber-700 tabular-nums">
        {formatTime(gap.from)}
      </span>
      <span className="w-16 shrink-0 font-mono text-xs text-amber-700 tabular-nums">
        {formatMinutes(gap.minutes)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-amber-900">
          Пропуск до {formatTime(gap.to)} — записей нет
        </div>
        <div className="mt-1.5">
          <LogGapButton
            fromIso={gap.from.toISOString()}
            toIso={gap.to.toISOString()}
            minutes={gap.minutes}
          />
        </div>
      </div>
    </li>
  );
}

function DeadlinesByDay({
  deadlines,
}: {
  deadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>;
}) {
  if (deadlines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ближайшие 7 дней без дедлайнов. Можно выдохнуть.
      </p>
    );
  }
  // Bucket tasks: overdue / today / +1 / +2 / ... / +6.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  type Bucket = {
    label: string;
    isOverdue?: boolean;
    isToday?: boolean;
    items: typeof deadlines;
  };
  const buckets: Bucket[] = [];
  const overdue: typeof deadlines = [];
  const byDay = new Map<number, typeof deadlines>();
  for (const t of deadlines) {
    if (!t.dueDate) continue;
    const d = new Date(t.dueDate);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d.getTime() - today.getTime()) / (24 * 3600_000));
    if (diffDays < 0) overdue.push(t);
    else {
      const arr = byDay.get(diffDays) ?? [];
      arr.push(t);
      byDay.set(diffDays, arr);
    }
  }
  if (overdue.length > 0) {
    buckets.push({ label: 'Просрочено', isOverdue: true, items: overdue });
  }
  for (let i = 0; i < 7; i++) {
    const items = byDay.get(i);
    if (!items?.length) continue;
    const date = new Date(today.getTime() + i * 24 * 3600_000);
    buckets.push({
      label:
        i === 0
          ? 'Сегодня'
          : i === 1
            ? 'Завтра'
            : date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      isToday: i === 0,
      items,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {buckets.map((b) => (
        <div key={b.label}>
          <div
            className={
              'mb-1 text-xs font-semibold uppercase tracking-wide ' +
              (b.isOverdue ? 'text-red-600' : b.isToday ? 'text-amber-600' : 'text-muted-foreground')
            }
          >
            {b.label}
          </div>
          <ul className="flex flex-col gap-1">
            {b.items.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/projects/${t.project.key}/tasks/${t.number}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {t.project.key}-{t.number}
                  </span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <TaskStatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
