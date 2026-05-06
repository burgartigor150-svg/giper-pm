import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { StatusBadge } from '@/components/domain/StatusBadge';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();
  const t = await getT('projects.detail');
  const tRoles = await getT('projects.memberRole');

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

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{project.key}</span>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        {canEdit ? (
          <Link href={`/projects/${project.key}/settings`}>
            <Button variant="outline" size="sm">
              {t('settings')}
            </Button>
          </Link>
        ) : null}
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
                <p className="mt-1 whitespace-pre-wrap text-sm">{project.description}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('members')} ({project.members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {project.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <Avatar src={m.user.image} alt={m.user.name} className="h-7 w-7" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">{m.user.name}</span>
                    <span className="text-xs text-muted-foreground">{m.user.email}</span>
                  </div>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                    {tRoles(m.role)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('recentTasks')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('noTasks')}</CardContent>
      </Card>
    </div>
  );
}
