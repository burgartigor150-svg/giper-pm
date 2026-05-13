import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canSeeReports } from '@/lib/permissions';
import { reportsFilterSchema, resolveRange } from '@/lib/reports/filters';
import { resolveScope } from '@/lib/reports/scope';
import {
  getBurndown,
  getHeatmap,
  getReportsTotals,
  getTimeByTask,
  getTopOverrun,
  getTypeDistribution,
  getVelocity,
} from '@/lib/reports/queries';
import { ReportsFilterBar } from '@/components/domain/reports/ReportsFilterBar';
import { VelocityChart } from '@/components/domain/reports/VelocityChart';
import { BurndownChart } from '@/components/domain/reports/BurndownChart';
import { HeatmapChart } from '@/components/domain/reports/HeatmapChart';
import { TopOverrunTable } from '@/components/domain/reports/TopOverrunTable';
import { TimeByTaskTable } from '@/components/domain/reports/TimeByTaskTable';
import { TypeDistributionChart } from '@/components/domain/reports/TypeDistributionChart';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const me = await requireAuth();
  if (!canSeeReports({ id: me.id, role: me.role })) notFound();

  const sp = await searchParams;
  const raw: Record<string, string> = {};
  for (const k of ['period', 'from', 'to', 'projectKey', 'userId']) {
    const v = sp[k];
    if (typeof v === 'string') raw[k] = v;
  }
  const filter = reportsFilterSchema.parse(raw);
  const range = resolveRange(filter);
  const scope = await resolveScope({ id: me.id, role: me.role }, filter);

  // Filter dropdowns: visible projects + (for PM/ADMIN) team members.
  // "My team" = scope.visibleUserIds (own PmTeam members + self). For
  // plain MEMBER/VIEWER the set is just self, so we hide the dropdown
  // by returning an empty list (one entry would be pointless).
  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: scope.visibleProjectIds }, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { key: true, name: true },
    }),
    (me.role === 'ADMIN' || me.role === 'PM') && scope.visibleUserIds.size > 1
      ? prisma.user.findMany({
          where: { id: { in: [...scope.visibleUserIds] }, isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Отчёты</h1>
      </div>

      <Card className="p-4">
        <ReportsFilterBar projects={projects} members={members} />
      </Card>

      <Suspense fallback={<HeroSkeleton />}>
        <Hero scope={scope} range={range} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Активность {range.granularity === 'week' ? '(по неделям)' : '(по дням)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton />}>
              <VelocitySection scope={scope} range={range} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Burndown</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton />}>
              <BurndownSection scope={scope} range={range} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Тепловая карта</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton />}>
              <HeatmapSection scope={scope} range={range} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Распределение по типам</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ChartSkeleton />}>
              <DistributionSection scope={scope} range={range} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Куда уходит время</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ChartSkeleton />}>
            <TimeByTaskSection scope={scope} range={range} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Топ задач с перерасходом</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ChartSkeleton />}>
            <OverrunSection scope={scope} range={range} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Sections (one Suspense each, parallel data loading) -------------

type SectionProps = {
  scope: Awaited<ReturnType<typeof resolveScope>>;
  range: ReturnType<typeof resolveRange>;
};

async function Hero({ scope, range }: SectionProps) {
  const totals = await getReportsTotals(scope, range);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label="Часов всего" value={totals.totalHours.toString()} />
      <Stat label="Активных людей" value={totals.activeUsers.toString()} />
      <Stat label="Задач со списанием" value={totals.workedTasks.toString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

async function VelocitySection({ scope, range }: SectionProps) {
  const data = await getVelocity(scope, range);
  return <VelocityChart data={data} />;
}

async function BurndownSection({ scope, range }: SectionProps) {
  const data = await getBurndown(scope, range);
  return <BurndownChart data={data} />;
}

async function HeatmapSection({ scope, range }: SectionProps) {
  const { grid, max } = await getHeatmap(scope, range);
  return <HeatmapChart grid={grid} max={max} />;
}

async function DistributionSection({ scope, range }: SectionProps) {
  const slices = await getTypeDistribution(scope, range);
  return <TypeDistributionChart slices={slices} />;
}

async function OverrunSection({ scope, range }: SectionProps) {
  const rows = await getTopOverrun(scope, range);
  return <TopOverrunTable rows={rows} />;
}

async function TimeByTaskSection({ scope, range }: SectionProps) {
  const { rows, untrackedHours } = await getTimeByTask(scope, range);
  return <TimeByTaskTable rows={rows} untrackedHours={untrackedHours} />;
}

function HeroSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-64 w-full animate-pulse rounded bg-muted" />;
}
