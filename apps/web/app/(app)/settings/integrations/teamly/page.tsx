import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { getTeamlyStatus } from '@/lib/integrations/teamly';
import { TeamlyIntegrationPanel } from '@/components/domain/integrations/TeamlyIntegrationPanel';

export const dynamic = 'force-dynamic';

export default async function TeamlyIntegrationPage() {
  const me = await requireAuth();
  if (!canSeeSettings(me)) notFound();

  const status = await getTeamlyStatus();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">TEAMLY</h1>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
            status.connected ? 'bg-green-100 text-green-700' : 'bg-neutral-200 text-neutral-700'
          }`}
        >
          {status.connected ? 'Подключено' : 'Не подключено'}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Импорт базы знаний</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamlyIntegrationPanel status={status} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Одностороннее зеркало: пространства и статьи TEAMLY импортируются в базу знаний (контент конвертируется из
        формата TEAMLY в markdown). Повторный запуск обновляет уже импортированные статьи. Умные таблицы и вложения —
        в следующих обновлениях интеграции.
      </p>
    </div>
  );
}
