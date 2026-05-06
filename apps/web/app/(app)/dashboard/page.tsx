import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Привет, {user.name ?? user.email}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Это заглушка дашборда. Дальше — список проектов, мои задачи, текущий таймер.
        </CardContent>
      </Card>
    </div>
  );
}
