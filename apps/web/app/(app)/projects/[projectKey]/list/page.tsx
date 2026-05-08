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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
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
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2">
                  <SortHeader field="number" label={tTable('number')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="title" label={tTable('title')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="status" label={tTable('status')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="assignee" label={tTable('assignee')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="estimateHours" label={tTable('estimate')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="dueDate" label={tTable('due')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
                <th className="px-4 py-2">
                  <SortHeader field="priority" label={tTable('priority')} currentField={filter.sort} currentDir={filter.dir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    <Link href={`/projects/${project.key}/tasks/${t.number}`} className="hover:underline">
                      {project.key}-{t.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/projects/${project.key}/tasks/${t.number}`} className="hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <TaskStatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2">
                    {t.assignee ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Avatar src={t.assignee.image} alt={t.assignee.name} className="h-6 w-6" />
                        {t.assignee.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {t.estimateHours ? `${t.estimateHours.toString()} ч` : '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <PriorityBadge priority={t.priority} />
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
