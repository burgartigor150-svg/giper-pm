import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { taskListFilterSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { listTasksForProject } from '@/lib/tasks';
import { canCreateTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { TaskFilters } from '@/components/domain/TaskFilters';
import { listTagsForProject } from '@/actions/tags';
import { SortHeader } from '@/components/domain/SortHeader';
import { Pagination } from '@/components/domain/Pagination';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { PriorityBadge } from '@/components/domain/PriorityBadge';

export default async function ProjectTasksListPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectKey } = await params;
  const sp = await searchParams;
  const me = await requireAuth();
  const t = await getT('tasks.list');
  const tTable = await getT('tasks.list.table');

  let project;
  try {
    project = await getProject(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  // Parse filters from URL with safe defaults
  const filterRaw: Record<string, unknown> = {};
  for (const k of ['status', 'priority', 'assigneeId', 'q', 'page', 'sort', 'dir']) {
    const v = sp[k];
    if (typeof v === 'string') filterRaw[k] = v;
  }
  // tagIds may arrive comma-joined or as an array depending on form encoding.
  const rawTagIds = sp.tagIds ?? sp.tagId;
  if (Array.isArray(rawTagIds)) {
    filterRaw.tagIds = rawTagIds;
  } else if (typeof rawTagIds === 'string') {
    filterRaw.tagIds = rawTagIds.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const parsed = taskListFilterSchema.safeParse(filterRaw);
  const filter = parsed.success
    ? parsed.data
    : taskListFilterSchema.parse({});

  const [result, availableTags] = await Promise.all([
    listTasksForProject(projectKey, filter, { id: me.id, role: me.role }),
    listTagsForProject(project.id),
  ]);

  // Members for assignee dropdown
  const members = [
    ...project.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
    })),
  ];

  const canCreate = canCreateTask(
    { id: me.id, role: me.role },
    { ownerId: project.ownerId, members: project.members },
  );

  // aria-sort wants "ascending" | "descending" | "none" — derive once
  // per header so JSX stays compact below.
  const ariaSortFor = (field: string): 'ascending' | 'descending' | 'none' => {
    if (filter.sort !== field) return 'none';
    return filter.dir === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 md:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${project.key}`}
            className="rounded-sm bg-muted px-2 py-1 font-mono text-xs tabular-nums transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {project.key}
          </Link>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </div>
        {canCreate ? (
          <Link href={`/projects/${project.key}/tasks/new`}>
            <Button>{t('create')}</Button>
          </Link>
        ) : null}
      </div>

      <Card className="p-4">
        <TaskFilters
          status={filter.status}
          priority={filter.priority}
          assigneeId={filter.assigneeId}
          q={filter.q}
          members={members}
          availableTags={availableTags}
          activeTagIds={filter.tagIds ?? []}
        />
      </Card>

      <Card className="overflow-hidden">
        {result.items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3" aria-sort={ariaSortFor('number')}>
                  <SortHeader field="number" label={tTable('number')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-3" aria-sort={ariaSortFor('title')}>
                  <SortHeader field="title" label={tTable('title')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-3" aria-sort={ariaSortFor('status')}>
                  <SortHeader field="status" label={tTable('status')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-3" aria-sort={ariaSortFor('assignee')}>
                  <SortHeader field="assignee" label={tTable('assignee')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                {/* Numeric columns right-aligned per MASTER §9.2 */}
                <th className="px-4 py-3 text-right" aria-sort={ariaSortFor('estimateHours')}>
                  <SortHeader field="estimateHours" label={tTable('estimate')} currentField={filter.sort} currentDir={filter.dir} align="right" />
                </th>
                <th className="px-4 py-3 text-right" aria-sort={ariaSortFor('dueDate')}>
                  <SortHeader field="dueDate" label={tTable('due')} currentField={filter.sort} currentDir={filter.dir} align="right" />
                </th>
                <th className="px-4 py-3" aria-sort={ariaSortFor('priority')}>
                  <SortHeader field="priority" label={tTable('priority')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-muted/50 focus-within:bg-muted/50"
                >
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                    <Link
                      href={`/projects/${project.key}/tasks/${task.number}`}
                      className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {project.key}-{task.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${project.key}/tasks/${task.number}`}
                      className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {task.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TaskStatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3">
                    {task.assignee ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Avatar src={task.assignee.image} alt={task.assignee.name} className="h-6 w-6" />
                        {task.assignee.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground" aria-label="не назначен">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {task.estimateHours ? (
                      <>
                        {task.estimateHours.toString()}
                        <span className="ml-1 text-xs text-muted-foreground/70">ч</span>
                      </>
                    ) : (
                      <span aria-label="оценка не задана">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {task.dueDate ? (
                      new Date(task.dueDate).toLocaleDateString('ru-RU')
                    ) : (
                      <span aria-label="срок не задан">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={task.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={result.page} pageCount={result.pageCount} />
      </Card>
    </div>
  );
}
