import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { EditProjectForm } from '@/components/domain/EditProjectForm';
import { MemberSearch } from '@/components/domain/MemberSearch';
import { MemberRow } from '@/components/domain/MemberRow';
import { WipLimitsForm } from '@/components/domain/WipLimitsForm';
import { PublishToBitrixButton } from '@/components/domain/PublishToBitrixButton';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();
  const t = await getT('projects.settings');

  let project;
  try {
    project = await getProject(projectKey, { id: user.id, role: user.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  if (
    !canEditProject(
      { id: user.id, role: user.role },
      { ownerId: project.ownerId, members: project.members },
    )
  ) {
    notFound();
  }

  const projectMirrored =
    project.externalSource === 'bitrix24' && !!project.externalId;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{project.key}</span>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="ml-auto">
          <PublishToBitrixButton
            kind="project"
            projectId={project.id}
            alreadyLinked={projectMirrored}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('save')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EditProjectForm
            project={{
              id: project.id,
              name: project.name,
              description: project.description,
              client: project.client,
              deadline: project.deadline,
              status: project.status,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WIP-лимиты канбана</CardTitle>
        </CardHeader>
        <CardContent>
          <WipLimitsForm
            projectId={project.id}
            initial={(project.wipLimits ?? null) as Record<string, number> | null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Участники ({project.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MemberSearch
            projectId={project.id}
            excludeUserIds={project.members.map((m) => m.user.id)}
          />
          <ul>
            {project.members.map((m) => (
              <MemberRow
                key={m.id}
                projectId={project.id}
                member={m}
                isOwner={m.user.id === project.ownerId}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
