import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@giper/ui/components/Card';
import { taskPrioritySchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { listTasksForBoard } from '@/lib/tasks';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { KanbanBoard } from '@/components/domain/KanbanBoard';
import { KanbanFilters } from '@/components/domain/KanbanFilters';
import { RevalidateOnEvent } from '@/components/domain/RevalidateOnEvent';
import { channelForProject } from '@giper/realtime';
import { listTagsForProject } from '@/actions/tags';

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectKey } = await params;
  const sp = await searchParams;
  const me = await requireAuth();
  const t = await getT('tasks.board');

  const assigneeId = typeof sp.assigneeId === 'string' ? sp.assigneeId : undefined;
  const priorityRaw = typeof sp.priority === 'string' ? sp.priority : undefined;
  const priorityParsed = priorityRaw ? taskPrioritySchema.safeParse(priorityRaw) : null;
  const priority = priorityParsed?.success ? priorityParsed.data : undefined;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const onlyMine = sp.onlyMine === '1';
  // tagIds may arrive as a single string or an array depending on the
  // form encoding. Normalize and trim before sending to the query.
  const rawTagIds = sp.tagIds ?? sp.tagId; // accept either spelling
  const tagIds = Array.isArray(rawTagIds)
    ? rawTagIds
    : typeof rawTagIds === 'string'
      ? rawTagIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

  let result;
  try {
    result = await listTasksForBoard(
      projectKey,
      { assigneeId, priority, q, onlyMine, tagIds },
      { id: me.id, role: me.role },
    );
  } catch (e) {
    if (
      e instanceof DomainError &&
      (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')
    ) {
      notFound();
    }
    throw e;
  }

  const { project, tasks } = result;

  // Members for filters: project members + owner (deduped by id).
  const memberMap = new Map<string, { id: string; name: string }>();
  for (const m of project.members) memberMap.set(m.user.id, { id: m.user.id, name: m.user.name });
  const members = Array.from(memberMap.values());

  // Available tags for the multi-select filter.
  const availableTags = await listTagsForProject(project.id);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <RevalidateOnEvent
        channel={channelForProject(project.id)}
        eventTypes={['task:status-changed', 'task:assigned', 'task:created']}
      />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${project.key}`}
            className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
          >
            {project.key}
          </Link>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
      </div>

      <Card className="p-4">
        <KanbanFilters
          members={members}
          assigneeId={assigneeId}
          priority={priority}
          q={q}
          onlyMine={onlyMine}
          availableTags={availableTags}
          activeTagIds={tagIds ?? []}
        />
      </Card>

      <KanbanBoard
        projectKey={project.key}
        initialTasks={tasks}
        wipLimits={
          (project.wipLimits ?? null) as Partial<
            Record<
              | 'BACKLOG'
              | 'TODO'
              | 'IN_PROGRESS'
              | 'REVIEW'
              | 'BLOCKED'
              | 'DONE'
              | 'CANCELED',
              number
            >
          > | null
        }
      />
    </div>
  );
}
