import { Suspense } from 'react';
import { requireAuth } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import {
  HeroSection,
  HeroSectionSkeleton,
} from '@/components/domain/dashboard/HeroSection';
import {
  TodayTotalSection,
  TodayTotalSectionSkeleton,
} from '@/components/domain/dashboard/TodayTotalSection';
import {
  DueTodaySection,
  InProgressSection,
  OverdueSection,
  TaskListSectionSkeleton,
} from '@/components/domain/dashboard/MyTasksSections';
import {
  ChartSection,
  ChartSectionSkeleton,
} from '@/components/domain/dashboard/ChartSection';

export default async function DashboardPage() {
  const me = await requireAuth();
  const t = await getT('dashboard');

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">
        {t('greeting', { name: me.name ?? me.email ?? '' })}
      </h1>

      <Suspense fallback={<HeroSectionSkeleton />}>
        <HeroSection userId={me.id} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<TaskListSectionSkeleton titleWidth={48} />}>
            <InProgressSection userId={me.id} />
          </Suspense>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Suspense fallback={<TaskListSectionSkeleton titleWidth={32} />}>
              <DueTodaySection userId={me.id} />
            </Suspense>
            <Suspense fallback={<TaskListSectionSkeleton titleWidth={28} />}>
              <OverdueSection userId={me.id} />
            </Suspense>
          </div>

          <Suspense fallback={<ChartSectionSkeleton />}>
            <ChartSection userId={me.id} />
          </Suspense>
        </div>

        <Suspense fallback={<TodayTotalSectionSkeleton />}>
          <TodayTotalSection userId={me.id} />
        </Suspense>
      </div>
    </div>
  );
}
