import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';
import { listVersionsForProject } from '@/lib/versions/listVersionsForProject';
import { VersionsManager } from '@/components/domain/VersionsManager';

export const dynamic = 'force-dynamic';

export default async function ProjectReleasesPage({
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

  const [versions, caps] = await Promise.all([
    listVersionsForProject(project.id),
    getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id),
  ]);
  const canManage = canEditProject(
    { id: me.id, role: me.role },
    { ownerId: project.ownerId, members: project.members },
    caps,
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${project.key}`}
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
        >
          {project.key}
        </Link>
        <h1 className="text-xl font-semibold">Релизы</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Версии проекта</CardTitle>
        </CardHeader>
        <CardContent>
          <VersionsManager projectKey={project.key} initial={versions} canManage={canManage} />
          <p className="mt-3 text-xs text-muted-foreground">
            Привязать карточку к версии можно из самой карточки (панель справа «Версия»),
            а отфильтровать доску/список по версии — через фильтр «Версия».
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
