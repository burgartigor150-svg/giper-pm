import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canCreateTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { CsvImportForm } from '@/components/domain/CsvImportForm';

export default async function ProjectImportPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: user.id, role: user.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }
  if (!canCreateTask({ id: user.id, role: user.role }, { ownerId: project.ownerId, members: project.members })) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${project.key}`}
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
        >
          {project.key}
        </Link>
        <h1 className="text-xl font-semibold">Импорт задач из CSV</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <CsvImportForm projectKey={project.key} />
        </CardContent>
      </Card>
    </div>
  );
}
