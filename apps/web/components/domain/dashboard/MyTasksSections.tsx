import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { listDueToday, listMyInProgress, listOverdue, type DashboardTask } from '@/lib/dashboard';
import { getT } from '@/lib/i18n';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { PriorityBadge } from '@/components/domain/PriorityBadge';

/**
 * Single row in a dashboard task list. One <Link> wraps the whole row
 * (vs the previous two-Link/one-row anti-pattern) so screen readers
 * and the tab order get a single navigable item. Hover row highlight
 * + focus-visible ring satisfy MASTER.md §7 + §9.1. Date uses
 * tabular-nums so columns don't jitter row-to-row.
 */
function TaskRow({ task }: { task: DashboardTask }) {
  return (
    <li>
      <Link
        href={`/projects/${task.project.key}/tasks/${task.number}`}
        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {task.project.key}-{task.number}
        </span>
        <span className="flex-1 truncate text-sm">{task.title}</span>
        <TaskStatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <span className="w-20 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {task.dueDate ? (
            new Date(task.dueDate).toLocaleDateString('ru-RU')
          ) : (
            <span aria-label="срок не задан">—</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Shared list shell — header + ul or empty state. Sections only differ
 * in the data fetcher and the title; everything else collapses here.
 */
function TaskListCard({
  title,
  titleClassName,
  TitleAdornment,
  emptyText,
  tasks,
}: {
  title: string;
  titleClassName?: string;
  TitleAdornment?: React.ComponentType<{ className?: string }>;
  emptyText: string;
  tasks: DashboardTask[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 text-base ${titleClassName ?? ''}`}>
          {TitleAdornment ? <TitleAdornment className="size-4 shrink-0" /> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((x) => (
              <TaskRow key={x.id} task={x} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function InProgressSection({ userId }: { userId: string }) {
  const tasks = await listMyInProgress(userId);
  const t = await getT('dashboard.inProgress');
  return <TaskListCard title={t('title')} emptyText={t('empty')} tasks={tasks} />;
}

export async function DueTodaySection({ userId }: { userId: string }) {
  const tasks = await listDueToday(userId);
  const t = await getT('dashboard.dueToday');
  return <TaskListCard title={t('title')} emptyText={t('empty')} tasks={tasks} />;
}

export async function OverdueSection({ userId }: { userId: string }) {
  const tasks = await listOverdue(userId);
  const t = await getT('dashboard.overdue');
  // Overdue is a destructive/error state — pair the colour with an
  // icon so the signal isn't colour-only (MASTER §10/§11).
  return (
    <TaskListCard
      title={t('title')}
      titleClassName="text-destructive"
      TitleAdornment={AlertTriangle}
      emptyText={t('empty')}
      tasks={tasks}
    />
  );
}

/**
 * Skeleton that matches the real TaskRow geometry (one row ≈ 44px tall:
 * py-2.5 = 20px + content). Five row stubs prevent the perceived
 * "almost nothing loaded" flash, which is also better for CLS than
 * showing two stubs and then jumping to 5 real rows.
 */
export function TaskListSectionSkeleton({ titleWidth = 32 }: { titleWidth?: number }) {
  return (
    <Card>
      <CardHeader>
        <div
          className="h-4 animate-pulse rounded bg-muted motion-reduce:animate-none"
          style={{ width: `${titleWidth * 4}px` }}
        />
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="-mx-2 flex items-center gap-3 px-2 py-2.5">
              <div className="h-3 w-12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-5 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
