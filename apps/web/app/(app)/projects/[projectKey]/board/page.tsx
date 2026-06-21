import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card } from '@giper/ui/components/Card';
import { taskPrioritySchema, taskTypeSchema, dueWithinSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { listTasksForBoard } from '@/lib/tasks';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { KanbanBoard } from '@/components/domain/KanbanBoard';
import { KanbanFilters } from '@/components/domain/KanbanFilters';
import { SavedFilterBar } from '@/components/domain/SavedFilterBar';
import { TemplatePicker } from '@/components/domain/TemplatePicker';
import { RevalidateOnEvent } from '@/components/domain/RevalidateOnEvent';
import { channelForProject } from '@giper/realtime';
import { listTagsForProject } from '@/actions/tags';
import {
  listSavedFiltersForView,
  resolveDefaultFilterQuery,
  hasExplicitFilterState,
} from '@/lib/savedFilters/listSavedFiltersForView';
import { listVersionsForProject } from '@/lib/versions/listVersionsForProject';
import { getCardTemplates } from '@/lib/board/getCardTemplates';
import { canCreateTask, canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';

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

  // Default-preset auto-apply: with no explicit filter state in the URL, redirect
  // to the viewer's default board preset (if any) so the URL stays shareable and
  // the filter bar reflects it. Guarded against empty-query redirect loops.
  if (!hasExplicitFilterState(sp)) {
    const def = await resolveDefaultFilterQuery(projectKey, 'BOARD', me.id);
    if (def && def.length > 0) redirect(`/projects/${projectKey}/board?${def}`);
  }

  const assigneeId = typeof sp.assigneeId === 'string' ? sp.assigneeId : undefined;
  const priorityRaw = typeof sp.priority === 'string' ? sp.priority : undefined;
  const priorityParsed = priorityRaw ? taskPrioritySchema.safeParse(priorityRaw) : null;
  const priority = priorityParsed?.success ? priorityParsed.data : undefined;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const onlyMine = sp.onlyMine === '1';
  const typeRaw = typeof sp.type === 'string' ? sp.type : undefined;
  const typeParsed = typeRaw ? taskTypeSchema.safeParse(typeRaw) : null;
  const type = typeParsed?.success ? typeParsed.data : undefined;
  const dueRaw = typeof sp.dueWithin === 'string' ? sp.dueWithin : undefined;
  const dueParsed = dueRaw ? dueWithinSchema.safeParse(dueRaw) : null;
  const dueWithin = dueParsed?.success ? dueParsed.data : undefined;
  const reviewer = sp.reviewer === 'me' ? 'me' : undefined;
  const versionId = typeof sp.versionId === 'string' && sp.versionId ? sp.versionId : undefined;
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
      { assigneeId, priority, q, onlyMine, tagIds, type, dueWithin, reviewer, versionId },
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

  const { project, tasks, columns, swimlanes } = result;

  // Members for filters: project members + owner (deduped by id).
  const memberMap = new Map<string, { id: string; name: string }>();
  for (const m of project.members) memberMap.set(m.user.id, { id: m.user.id, name: m.user.name });
  const members = Array.from(memberMap.values());

  // Available tags for the multi-select filter.
  const availableTags = await listTagsForProject(project.id);

  // Saved filter presets + whether the viewer may publish/prune shared presets.
  const [presets, projCaps, versions] = await Promise.all([
    listSavedFiltersForView(project.id, 'BOARD', me.id),
    getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id),
    listVersionsForProject(project.id),
  ]);
  const canShare = canEditProject(
    { id: me.id, role: me.role },
    { ownerId: project.ownerId, members: project.members },
    projCaps,
  );

  // Card templates: only offer the picker to users who can create
  // tasks here, and only when the project actually has templates.
  const canCreate = canCreateTask(
    { id: me.id, role: me.role },
    { ownerId: project.ownerId, members: project.members },
  );
  const cardTemplates = canCreate ? await getCardTemplates(project.id) : [];

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
        <TemplatePicker
          projectKey={project.key}
          templates={cardTemplates.map((tpl) => ({ id: tpl.id, name: tpl.name }))}
        />
      </div>

      <Card className="space-y-3 p-4">
        <SavedFilterBar
          projectKey={project.key}
          scope="BOARD"
          presets={presets}
          canShare={canShare}
        />
        <KanbanFilters
          members={members}
          assigneeId={assigneeId}
          priority={priority}
          q={q}
          onlyMine={onlyMine}
          type={type}
          dueWithin={dueWithin}
          reviewer={reviewer}
          versionId={versionId}
          versions={versions.map((v) => ({ id: v.id, name: v.name }))}
          availableTags={availableTags}
          activeTagIds={tagIds ?? []}
        />
      </Card>

      <KanbanBoard
        projectKey={project.key}
        initialTasks={tasks}
        columns={columns}
        swimlanes={swimlanes}
      />
    </div>
  );
}
