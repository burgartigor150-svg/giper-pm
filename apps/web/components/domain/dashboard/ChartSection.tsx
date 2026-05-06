import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { getLast7Days } from '@/lib/dashboard';
import { getT } from '@/lib/i18n';
import { Last7DaysChart } from './Last7DaysChart';

export async function ChartSection({ userId }: { userId: string }) {
  const data = await getLast7Days(userId);
  const t = await getT('dashboard.chart');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Last7DaysChart data={data} />
      </CardContent>
    </Card>
  );
}

export function ChartSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-4 w-44 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}
