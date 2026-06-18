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
import { BoardColumnsForm } from '@/components/domain/BoardColumnsForm';
import { SwimlanesForm } from '@/components/domain/SwimlanesForm';
import { CustomFieldsForm } from '@/components/domain/CustomFieldsForm';
import { getBoardColumns } from '@/lib/board/getBoardColumns';
import { getBoardSwimlanes } from '@/lib/board/getBoardSwimlanes';
import { getCustomFields } from '@/lib/board/getCustomFields';
import { AutomationsForm } from '@/components/domain/AutomationsForm';
import { getAutomations } from '@/lib/board/getAutomations';
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

  const boardColumns = await getBoardColumns(project.id);
  const boardSwimlanes = await getBoardSwimlanes(project.id);
  const customFields = await getCustomFields(project.id);
  const automations = await getAutomations(project.id);
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
          <CardTitle>Колонки доски</CardTitle>
        </CardHeader>
        <CardContent>
          <BoardColumnsForm projectId={project.id} initial={boardColumns} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дорожки доски</CardTitle>
        </CardHeader>
        <CardContent>
          <SwimlanesForm projectId={project.id} initial={boardSwimlanes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Поля задач</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomFieldsForm projectId={project.id} initial={customFields} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Автоматизации</CardTitle>
        </CardHeader>
        <CardContent>
          <AutomationsForm
            projectId={project.id}
            initial={automations}
            columns={boardColumns.map((c) => ({ status: c.status, name: c.name }))}
            swimlanes={boardSwimlanes.map((s) => ({ id: s.id, name: s.name }))}
            members={project.members.map((m) => ({
              id: m.user.id,
              name: m.user.name ?? m.user.id,
            }))}
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
