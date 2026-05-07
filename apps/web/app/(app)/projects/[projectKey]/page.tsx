import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject, canCreateTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { renderRichText } from '@/lib/text/renderRichText';
import { StatusBadge } from '@/components/domain/StatusBadge';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { listRecentTasksForProject } from '@/lib/tasks';
import { ProjectMembersEditor } from '@/components/domain/ProjectMembersEditor';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();
  const t = await getT('projects.detail');

  let project;
  try {
    project = await getProject(projectKey, { id: user.id, role: user.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  const canEdit = canEditProject(
    { id: user.id, role: user.role },
    { ownerId: project.ownerId, members: project.members },
  );
  const canCreate = canCreateTask(
    { id: user.id, role: user.role },
    { ownerId: project.ownerId, members: project.members },
  );

  const recent = await listRecentTasksForProject(project.id, 5);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{project.key}</span>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/projects/${project.key}/board`}>
            <Button variant="outline" size="sm">Канбан</Button>
          </Link>
          <Link href={`/projects/${project.key}/list`}>
            <Button variant="outline" size="sm">Задачи</Button>
          </Link>
          {canCreate ? (
            <Link href={`/projects/${project.key}/tasks/new`}>
              <Button size="sm">+ Задача</Button>
            </Link>
          ) : null}
          {canEdit ? (
            <Link href={`/projects/${project.key}/settings`}>
              <Button variant="outline" size="sm">
                {t('settings')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('overview')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase text-muted-foreground">{t('owner')}</div>
              <div className="mt-1 flex items-center gap-2">
                <Avatar src={project.owner.image} alt={project.owner.name} className="h-6 w-6" />
                {project.owner.name}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">{t('client')}</div>
              <div className="mt-1">{project.client ?? t('noClient')}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">{t('deadline')}</div>
              <div className="mt-1">
                {project.deadline
                  ? new Date(project.deadline).toLocaleDateString('ru-RU')
                  : t('noDeadline')}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">{t('createdAt')}</div>
              <div className="mt-1">
                {new Date(project.createdAt).toLocaleDateString('ru-RU')}
              </div>
            </div>
            {project.description ? (
              <div className="col-span-2">
                <div className="text-xs uppercase text-muted-foreground">Описание</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{renderRichText(project.description)}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('members')} ({project.members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectMembersEditor
              projectId={project.id}
              members={project.members}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('recentTasks')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noTasks')}</p>
          ) : (
            <ul className="flex flex-col">
              {recent.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
                >
                  <Link
                    href={`/projects/${project.key}/tasks/${task.number}`}
                    className="font-mono text-xs text-muted-foreground hover:underline"
                  >
                    {project.key}-{task.number}
                  </Link>
                  <Link
                    href={`/projects/${project.key}/tasks/${task.number}`}
                    className="flex-1 text-sm hover:underline"
                  >
                    {task.title}
                  </Link>
                  <TaskStatusBadge status={task.status} />
                  {task.assignee ? (
                    <Avatar src={task.assignee.image} alt={task.assignee.name} className="h-6 w-6" />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
