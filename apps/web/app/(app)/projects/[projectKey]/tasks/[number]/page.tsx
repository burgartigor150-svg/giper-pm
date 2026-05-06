import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getTask } from '@/lib/tasks';
import { canDeleteTask, canEditTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { InlineTitle } from '@/components/domain/InlineTitle';
import { InlineDescription } from '@/components/domain/InlineDescription';
import { TaskSidebar } from '@/components/domain/TaskSidebar';
import { CommentForm } from '@/components/domain/CommentForm';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { DeleteTaskButton } from '@/components/domain/DeleteTaskButton';

type Params = Promise<{ projectKey: string; number: string }>;

export default async function TaskDetailPage({ params }: { params: Params }) {
  const { projectKey, number: numberStr } = await params;
  const number = Number.parseInt(numberStr, 10);
  if (!Number.isFinite(number) || number < 1) notFound();

  const me = await requireAuth();
  const t = await getT('tasks.detail');
  const tStatus = await getT('tasks.status');

  let task;
  try {
    task = await getTask(projectKey, number, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  // Resolve actor names for status changes (only IDs are stored on TaskStatusChange).
  const actorIds = Array.from(new Set(task.statusChanges.map((sc) => sc.changedById)));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const actorById = new Map(actors.map((u) => [u.id, u]));

  const canEdit = canEditTask(
    { id: me.id, role: me.role },
    {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      project: { ownerId: task.project.ownerId, members: task.project.members },
    },
  );
  const canDelete = canDeleteTask(
    { id: me.id, role: me.role },
    {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      project: { ownerId: task.project.ownerId, members: task.project.members },
    },
  );

  const members = task.project.members.map((m) => m.user);

  // Merge comments + status changes into a single timeline.
  type TLItem =
    | { kind: 'comment'; at: Date; id: string; author: { id: string; name: string; image: string | null }; body: string }
    | {
        kind: 'status';
        at: Date;
        id: string;
        actor: { id: string; name: string; image: string | null } | null;
        from: typeof task.statusChanges[number]['fromStatus'];
        to: typeof task.statusChanges[number]['toStatus'];
      };

  const timeline: TLItem[] = [
    ...task.comments.map(
      (c): TLItem => ({
        kind: 'comment',
        at: c.createdAt,
        id: c.id,
        author: c.author,
        body: c.body,
      }),
    ),
    ...task.statusChanges.map(
      (sc): TLItem => ({
        kind: 'status',
        at: sc.changedAt,
        id: sc.id,
        actor: actorById.get(sc.changedById) ?? null,
        from: sc.fromStatus,
        to: sc.toStatus,
      }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/projects/${task.project.key}/list`} className="text-sm text-muted-foreground hover:underline">
          {t('back')}
        </Link>
        {canDelete ? <DeleteTaskButton taskId={task.id} projectKey={task.project.key} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {task.project.key}-{task.number}
        </span>
        <TaskStatusBadge status={task.status} />
      </div>

      <InlineTitle
        taskId={task.id}
        projectKey={task.project.key}
        taskNumber={task.number}
        initial={task.title}
        canEdit={canEdit}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-6">
              <InlineDescription
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                initial={task.description}
                canEdit={canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('timeline')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noTimeline')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {timeline.map((item) =>
                    item.kind === 'comment' ? (
                      <li key={`c-${item.id}`} className="flex gap-3">
                        <Avatar src={item.author.image} alt={item.author.name} className="h-7 w-7" />
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{item.author.name}</span>
                            <span>{item.at.toLocaleString('ru-RU')}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
                        </div>
                      </li>
                    ) : (
                      <li key={`s-${item.id}`} className="flex gap-3 text-xs text-muted-foreground">
                        <span className="mt-0.5 inline-block h-7 w-7 shrink-0 rounded-full bg-muted text-center leading-7">
                          ↺
                        </span>
                        <div className="flex flex-1 flex-col">
                          <span>
                            <span className="font-medium text-foreground">
                              {item.actor?.name ?? '—'}
                            </span>{' '}
                            {item.from
                              ? `изменил(а) статус: ${tStatus(item.from)} → ${tStatus(item.to)}`
                              : `установил(а) статус: ${tStatus(item.to)}`}
                          </span>
                          <span>{item.at.toLocaleString('ru-RU')}</span>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <CommentForm
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <TaskSidebar
              taskId={task.id}
              projectKey={task.project.key}
              taskNumber={task.number}
              status={task.status}
              priority={task.priority}
              assignee={task.assignee}
              estimate={task.estimateHours?.toString() ?? null}
              due={task.dueDate}
              tags={task.tags}
              members={members}
              canEdit={canEdit}
              creator={task.creator}
              startedAt={task.startedAt}
              completedAt={task.completedAt}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
