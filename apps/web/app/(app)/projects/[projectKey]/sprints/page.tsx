import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { listTasksForBoard } from '@/lib/tasks';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';
import { getSprints } from '@/lib/sprints/getSprints';
import { getActiveSprint } from '@/lib/sprints/getActiveSprint';
import { getSprintBurndown } from '@/lib/sprints/getSprintBurndown';
import { SprintsForm } from '@/components/domain/SprintsForm';
import { SprintBurndownChart } from '@/components/domain/SprintBurndownChart';
import { KanbanBoard } from '@/components/domain/KanbanBoard';

export const dynamic = 'force-dynamic';

export default async function ProjectSprintsPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const me = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  const canManage = canEditProject(
    { id: me.id, role: me.role },
    { ownerId: project.ownerId, members: project.members },
    await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id),
  );

  const [sprints, active] = await Promise.all([
    getSprints(project.id),
    getActiveSprint(project.id),
  ]);

  // Active-sprint board + burndown (reuse the kanban with a sprint filter).
  let board: Awaited<ReturnType<typeof listTasksForBoard>> | null = null;
  let burndown = null;
  if (active) {
    [board, burndown] = await Promise.all([
      listTasksForBoard(projectKey, { sprintId: active.id }, { id: me.id, role: me.role }).catch(() => null),
      getSprintBurndown(active.id),
    ]);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${project.key}`}
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
        >
          {project.key}
        </Link>
        <h1 className="text-xl font-semibold">Спринты</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Спринты проекта</CardTitle>
        </CardHeader>
        <CardContent>
          <SprintsForm projectKey={project.key} initial={sprints} canManage={canManage} />
          <p className="mt-3 text-xs text-muted-foreground">
            Добавить карточку в спринт можно из самой карточки (в правой панели «Спринт»).
          </p>
        </CardContent>
      </Card>

      {active ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Прогресс активного спринта: {active.name}</CardTitle>
            </CardHeader>
            <CardContent>
              {burndown ? (
                <SprintBurndownChart data={burndown} />
              ) : (
                <p className="text-sm text-muted-foreground">Нет данных по спринту.</p>
              )}
            </CardContent>
          </Card>

          {board ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">Доска активного спринта</h2>
              <KanbanBoard
                projectKey={project.key}
                initialTasks={board.tasks}
                columns={board.columns}
                swimlanes={board.swimlanes}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Нет активного спринта. Создайте спринт и нажмите «Старт».
        </p>
      )}
    </div>
  );
}
