import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { getTodayTotals } from '@/lib/dashboard';
import { getT } from '@/lib/i18n';
import { minutesToHours } from '@/lib/format/duration';
import { TimeProjectPie, colorForIndex } from '@/components/domain/TimeProjectPie';

export async function TodayTotalSection({ userId }: { userId: string }) {
  const totals = await getTodayTotals(userId);
  const t = await getT('dashboard.todayTotal');

  const slices = totals.perProject.map((p, i) => ({
    label: p.name,
    minutes: p.minutes,
    color: colorForIndex(i),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="text-4xl font-semibold tracking-tight">
          {minutesToHours(totals.totalMin)}
        </div>
        {slices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noEntries')}</p>
        ) : (
          <>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('perProject')}
            </div>
            <TimeProjectPie slices={slices} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TodayTotalSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-10 w-20 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-32 w-32 animate-pulse rounded-full bg-muted" />
      </CardContent>
    </Card>
  );
}
