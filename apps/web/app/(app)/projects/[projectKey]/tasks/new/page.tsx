import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canCreateTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { NewTaskForm } from '@/components/domain/NewTaskForm';

export default async function NewTaskPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const me = await requireAuth();
  const t = await getT('tasks.list');

  let project;
  try {
    project = await getProject(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  if (!canCreateTask({ id: me.id, role: me.role }, { ownerId: project.ownerId, members: project.members })) {
    notFound();
  }

  const members = project.members.map((m) => ({
    id: m.user.id,
    name: m.user.name,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('create')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewTaskForm
            projectKey={project.key}
            members={members}
            projectMirrored={
              project.externalSource === 'bitrix24' && !!project.externalId
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
