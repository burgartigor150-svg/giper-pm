import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getT } from '@/lib/i18n';

export default async function DashboardPage() {
  const user = await requireAuth();
  const t = await getT('dashboard');

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('greeting', { name: user.name ?? user.email ?? '' })}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('stub')}</CardContent>
      </Card>
    </div>
  );
}
