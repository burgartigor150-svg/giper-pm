import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getGanttData } from '@/lib/gantt/getGanttData';
import { DomainError } from '@/lib/errors';
import { GanttChart } from '@/components/domain/GanttChart';

export default async function ProjectGanttPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const me = await requireAuth();

  let data;
  try {
    data = await getGanttData(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (
      e instanceof DomainError &&
      (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')
    ) {
      notFound();
    }
    throw e;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${data.project.key}`}
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
        >
          {data.project.key}
        </Link>
        <h1 className="text-xl font-semibold">Гант / таймлайн</h1>
      </div>

      <Card className="p-4">
        <CardContent className="p-0">
          <GanttChart projectKey={data.project.key} tasks={data.tasks} />
        </CardContent>
      </Card>
    </div>
  );
}
