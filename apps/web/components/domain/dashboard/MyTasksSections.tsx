import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { listDueToday, listMyInProgress, listOverdue, type DashboardTask } from '@/lib/dashboard';
import { getT } from '@/lib/i18n';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { PriorityBadge } from '@/components/domain/PriorityBadge';

function TaskRow({ task }: { task: DashboardTask }) {
  return (
    <li className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <Link
        href={`/projects/${task.project.key}/tasks/${task.number}`}
        className="font-mono text-xs text-muted-foreground hover:underline"
      >
        {task.project.key}-{task.number}
      </Link>
      <Link
        href={`/projects/${task.project.key}/tasks/${task.number}`}
        className="flex-1 truncate text-sm hover:underline"
      >
        {task.title}
      </Link>
      <TaskStatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
      {task.dueDate ? (
        <span className="text-xs text-muted-foreground">
          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </span>
      ) : null}
    </li>
  );
}

export async function InProgressSection({ userId }: { userId: string }) {
  const tasks = await listMyInProgress(userId);
  const t = await getT('dashboard.inProgress');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul>
            {tasks.map((x) => (
              <TaskRow key={x.id} task={x} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function DueTodaySection({ userId }: { userId: string }) {
  const tasks = await listDueToday(userId);
  const t = await getT('dashboard.dueToday');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul>
            {tasks.map((x) => (
              <TaskRow key={x.id} task={x} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function OverdueSection({ userId }: { userId: string }) {
  const tasks = await listOverdue(userId);
  const t = await getT('dashboard.overdue');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-amber-700">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul>
            {tasks.map((x) => (
              <TaskRow key={x.id} task={x} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TaskListSectionSkeleton({ titleWidth = 32 }: { titleWidth?: number }) {
  return (
    <Card>
      <CardHeader>
        <div
          className="h-4 animate-pulse rounded bg-muted"
          style={{ width: `${titleWidth * 4}px` }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="h-5 w-full animate-pulse rounded bg-muted" />
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}
