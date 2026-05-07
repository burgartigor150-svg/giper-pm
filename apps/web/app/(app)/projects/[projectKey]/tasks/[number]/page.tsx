import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getTask } from '@/lib/tasks';
import { getActiveTimer, getTaskSpentMinutes } from '@/lib/time';
import { canDeleteTask, canEditTask, canEditTaskInternal } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { InlineTitle } from '@/components/domain/InlineTitle';
import { InlineDescription } from '@/components/domain/InlineDescription';
import { TaskSidebar } from '@/components/domain/TaskSidebar';
import { TaskTimeline } from '@/components/domain/TaskTimeline';
import { LogTaskHoursForm } from '@/components/domain/LogTaskHoursForm';
import { listTaskTimeEntries } from '@/actions/time';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { DeleteTaskButton } from '@/components/domain/DeleteTaskButton';
import { TaskTimerButton } from '@/components/domain/TaskTimerButton';
import { Bitrix24TaskBadge } from '@/components/domain/Bitrix24Badge';
import { Bitrix24SyncStatus } from '@/components/domain/Bitrix24SyncStatus';
import { BitrixMirrorPanel } from '@/components/domain/BitrixMirrorPanel';
import { PublishToBitrixButton } from '@/components/domain/PublishToBitrixButton';
import { TaskAttachments } from '@/components/domain/TaskAttachments';
import { AttachmentUpload } from '@/components/domain/AttachmentUpload';
import { PullRequestList } from '@/components/domain/PullRequestList';
import { RevalidateOnEvent } from '@/components/domain/RevalidateOnEvent';
import { PresenceBar } from '@/components/domain/PresenceBar';
import { SubtaskList } from '@/components/domain/SubtaskList';
import { Checklists } from '@/components/domain/Checklists';
import { SendToReviewCTA } from '@/components/domain/SendToReviewCTA';
import { TaskGraph } from '@/components/domain/TaskGraph';
import { getTaskGraph } from '@/lib/tasks/getTaskGraph';
import { Dependencies } from '@/components/domain/Dependencies';
import { TagPicker } from '@/components/domain/TagPicker';
import { listTagsForProject } from '@/actions/tags';
import { channelForTask } from '@giper/realtime';
import { WatchToggle } from '@/components/domain/WatchToggle';
import { isWatchingTask } from '@/lib/watchers/isWatching';

type Params = Promise<{ projectKey: string; number: string }>;

export default async function TaskDetailPage({ params }: { params: Params }) {
  const { projectKey, number: numberStr } = await params;
  const number = Number.parseInt(numberStr, 10);
  if (!Number.isFinite(number) || number < 1) notFound();

  const me = await requireAuth();
  const t = await getT('tasks.detail');

  let task;
  try {
    task = await getTask(projectKey, number, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  const [
    activeTimer,
    spentMinutes,
    watchingExplicit,
    taskTimeEntries,
    availableTags,
    graph,
  ] = await Promise.all([
    getActiveTimer(me.id),
    getTaskSpentMinutes(task.id),
    isWatchingTask(task.id, me.id),
    listTaskTimeEntries(task.id, 10),
    listTagsForProject(task.project.id),
    getTaskGraph(task.id),
  ]);
  // Assignee/creator are always notified — the explicit watch toggle is
  // disabled with a tooltip in that case.
  const watchImplicit = task.assigneeId === me.id || task.creatorId === me.id;

  // Resolve actor names for status changes (only IDs are stored on
  // TaskStatusChange) plus any users referenced as @mentions in comments
  // — we render them as inline name pills, not raw "@<userId>" tokens.
  const referencedIds = new Set<string>(task.statusChanges.map((sc) => sc.changedById));
  const mentionRe = /@([a-z0-9]{24,})\b/g;
  for (const c of task.comments) {
    let m: RegExpExecArray | null;
    while ((m = mentionRe.exec(c.body)) !== null) {
      if (m[1]) referencedIds.add(m[1]);
    }
  }
  const referenced = referencedIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...referencedIds] } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const actorById = new Map(referenced.map((u) => [u.id, u]));

  // Two edit gates:
  //   - canEditMirror: strict — required to write title/description and
  //     to mutate the Bitrix-mirror status. Returns false on any task
  //     where externalSource is set.
  //   - canEditInternal: relaxed — allows editing the internal status,
  //     internal assignments, reviewer, estimate, due, tags, priority,
  //     checklists, dependencies on Bitrix-mirrored tasks too.
  const canEditMirror = canEditTask(
    { id: me.id, role: me.role },
    {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      externalSource: task.externalSource,
      project: { ownerId: task.project.ownerId, members: task.project.members },
    },
  );
  const canEdit = canEditTaskInternal(
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

  // Pool of candidates for assignee/reviewer/co-assignee pickers:
  //   1. explicit project members
  //   2. people already involved with this task (assignee, creator,
  //      reviewer, co-assignees) — mirrors picks the user has already
  //      made for this task even if they aren't formal project members
  //   3. all active users in the system — gives a baseline so brand-new
  //      Bitrix-mirror tasks (no project members) still have a list to
  //      pick from. Inactive Bitrix stubs are kept out by default.
  const memberPool = new Map<string, { id: string; name: string; image: string | null }>();
  for (const m of task.project.members) memberPool.set(m.user.id, m.user);
  if (task.assignee) memberPool.set(task.assignee.id, task.assignee);
  if (task.creator) memberPool.set(task.creator.id, task.creator);
  if (task.reviewer) memberPool.set(task.reviewer.id, task.reviewer);
  for (const a of task.assignments) memberPool.set(a.user.id, a.user);
  const activeUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, image: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  for (const u of activeUsers) if (!memberPool.has(u.id)) memberPool.set(u.id, u);
  const members = Array.from(memberPool.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Merge comments + status changes into a single timeline.
  type TLItem =
    | {
        kind: 'comment';
        at: Date;
        id: string;
        author: { id: string; name: string; image: string | null };
        body: string;
        visibility: 'EXTERNAL' | 'INTERNAL';
      }
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
        visibility: c.visibility,
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
      <RevalidateOnEvent
        channel={channelForTask(task.id)}
        eventTypes={[
          'comment:added',
          'task:status-changed',
          'task:assigned',
        ]}
      />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/projects/${task.project.key}/list`} className="hover:underline">
            {t('back')}
          </Link>
          {task.parent ? (
            <>
              <span>·</span>
              <Link
                href={`/projects/${task.parent.project.key}/tasks/${task.parent.number}`}
                className="inline-flex items-center gap-1 hover:underline"
                title={task.parent.title}
              >
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {task.parent.project.key}-{task.parent.number}
                </span>
                <span className="max-w-[200px] truncate">{task.parent.title}</span>
              </Link>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <WatchToggle
            taskId={task.id}
            projectKey={task.project.key}
            taskNumber={task.number}
            initialWatching={watchingExplicit}
            implicit={watchImplicit}
          />
          <TaskTimerButton taskId={task.id} activeTimer={activeTimer} />
          {canDelete ? <DeleteTaskButton taskId={task.id} projectKey={task.project.key} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {task.project.key}-{task.number}
        </span>
        <TaskStatusBadge status={task.status} />
        {task.externalSource === 'bitrix24' && task.externalId ? (
          <>
            <Bitrix24TaskBadge externalId={task.externalId} />
            {!task.syncConflict ? (
              <Bitrix24SyncStatus
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                syncedAt={task.bitrixSyncedAt}
                conflict={false}
              />
            ) : null}
          </>
        ) : (
          // Local-only task — show "publish to Bitrix" only when the
          // parent project is mirrored. Otherwise the button is rendered
          // disabled with a hint explaining "опубликуйте проект сначала".
          <PublishToBitrixButton
            kind="task"
            taskId={task.id}
            projectKey={task.project.key}
            taskNumber={task.number}
            alreadyLinked={false}
            projectMirrored={
              task.project.externalSource === 'bitrix24' &&
              !!task.project.externalId
            }
          />
        )}
        <PresenceBar taskId={task.id} meId={me.id} />
      </div>

      {task.externalSource === 'bitrix24' && task.syncConflict ? (
        <Bitrix24SyncStatus
          taskId={task.id}
          projectKey={task.project.key}
          taskNumber={task.number}
          syncedAt={task.bitrixSyncedAt}
          conflict={true}
        />
      ) : null}

      <InlineTitle
        taskId={task.id}
        projectKey={task.project.key}
        taskNumber={task.number}
        initial={task.title}
        canEdit={canEditMirror}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="pt-6">
              <InlineDescription
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                initial={task.description}
                canEdit={canEditMirror}
              />
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Теги
                </div>
                <TagPicker
                  taskId={task.id}
                  projectId={task.project.id}
                  assigned={task.taskTags.map((tt) => tt.tag)}
                  available={availableTags}
                  canEdit={canEdit}
                />
              </div>
            </CardContent>
          </Card>

          {task.subtasks.length > 0 || canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Подзадачи</CardTitle>
              </CardHeader>
              <CardContent>
                <SubtaskList
                  projectKey={task.project.key}
                  parentTaskId={task.id}
                  subtasks={task.subtasks}
                  canAdd={canEdit}
                />
              </CardContent>
            </Card>
          ) : null}

          {task.checklists.length > 0 || canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Чек-листы</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Checklists
                  taskId={task.id}
                  projectKey={task.project.key}
                  taskNumber={task.number}
                  checklists={task.checklists}
                  canEdit={canEdit}
                />
                {canEdit ? (
                  <SendToReviewCTA
                    taskId={task.id}
                    projectKey={task.project.key}
                    taskNumber={task.number}
                    internalStatus={task.internalStatus}
                    checklists={task.checklists}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {task.blocks.length > 0 || task.blockedBy.length > 0 || canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Зависимости</CardTitle>
              </CardHeader>
              <CardContent>
                <Dependencies
                  taskId={task.id}
                  projectKey={task.project.key}
                  taskNumber={task.number}
                  blocks={task.blocks.map((b) => ({ id: b.id, task: b.toTask }))}
                  blockedBy={task.blockedBy.map((b) => ({ id: b.id, task: b.fromTask }))}
                  canEdit={canEdit}
                />
              </CardContent>
            </Card>
          ) : null}

          {graph && graph.nodes.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Граф связей</CardTitle>
              </CardHeader>
              <CardContent>
                <TaskGraph nodes={graph.nodes} edges={graph.edges} />
              </CardContent>
            </Card>
          ) : null}

          {task.pullRequests.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pull-requests</CardTitle>
              </CardHeader>
              <CardContent>
                <PullRequestList items={task.pullRequests} />
              </CardContent>
            </Card>
          ) : null}

          {task.attachments.length > 0 || canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('attachments')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {task.attachments.length > 0 ? (
                  <TaskAttachments attachments={task.attachments} />
                ) : null}
                {canEdit ? (
                  <AttachmentUpload
                    taskId={task.id}
                    projectKey={task.project.key}
                    taskNumber={task.number}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Время</CardTitle>
            </CardHeader>
            <CardContent>
              <LogTaskHoursForm
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                currentUserId={me.id}
                entries={taskTimeEntries}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('timeline')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskTimeline
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                items={timeline}
                isMirror={task.externalSource === 'bitrix24'}
                mentions={actorById}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {task.externalSource === 'bitrix24' ? (
            <BitrixMirrorPanel status={task.status} assignee={task.assignee} />
          ) : null}
          <Card>
            <CardContent className="pt-6">
              <TaskSidebar
                taskId={task.id}
                projectKey={task.project.key}
                taskNumber={task.number}
                internalStatus={task.internalStatus}
                priority={task.priority}
                reviewer={task.reviewer}
                assignments={task.assignments}
                estimate={task.estimateHours?.toString() ?? null}
                spentMinutes={spentMinutes}
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
    </div>
  );
}

