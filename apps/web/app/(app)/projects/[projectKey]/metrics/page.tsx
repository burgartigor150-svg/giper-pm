import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { DomainError } from '@/lib/errors';
import { getBoardMetrics } from '@/lib/board/getBoardMetrics';
import { getCumulativeFlow } from '@/lib/board/getCumulativeFlow';
import { BoardMetricsCharts } from '@/components/domain/BoardMetricsCharts';
import { CumulativeFlowChart } from '@/components/domain/CumulativeFlowChart';

function fmtDur(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 48) return `${hours.toFixed(1)} ч`;
  return `${(hours / 24).toFixed(1)} дн`;
}

export default async function ProjectMetricsPage({
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
    if (
      e instanceof DomainError &&
      (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')
    ) {
      notFound();
    }
    throw e;
  }

  const metrics = await getBoardMetrics(project.id, Date.now());
  const cfd = await getCumulativeFlow(project.id, 30);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${project.key}`}
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
        >
          {project.key}
        </Link>
        <h1 className="text-xl font-semibold">Метрики</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Lead time (медиана)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtDur(metrics.leadHoursMedian)}
            </p>
            <p className="text-xs text-muted-foreground">создание → завершение</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cycle time (медиана)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtDur(metrics.cycleHoursMedian)}
            </p>
            <p className="text-xs text-muted-foreground">в работе → завершение</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Завершено задач
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {metrics.completedCount}
            </p>
            <p className="text-xs text-muted-foreground">всего с завершением</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <BoardMetricsCharts metrics={metrics} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Кумулятивный поток (CFD)</CardTitle>
        </CardHeader>
        <CardContent>
          <CumulativeFlowChart data={cfd} />
          <p className="mt-3 text-xs text-muted-foreground">
            Количество карточек в каждом статусе по дням. Расширяющаяся полоса «В
            работе» — копится незавершёнка; растущий разрыв между «Бэклог» и
            «Готово» — растёт время цикла. Считается по суточным снимкам (cron).
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Метрики считаются по жизненному циклу задач (отметки «в работе» /
        «завершено»). Наиболее полны для задач команды; у Bitrix-зеркал часть
        переходов приходит из синхронизации.
      </p>
    </div>
  );
}
