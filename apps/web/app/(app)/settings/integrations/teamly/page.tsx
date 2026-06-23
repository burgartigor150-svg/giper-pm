import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getTeamlyStatus } from '@/lib/integrations/teamly';
import { TeamlyIntegrationPanel } from '@/components/domain/integrations/TeamlyIntegrationPanel';

export const dynamic = 'force-dynamic';

export default async function TeamlyIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; slug?: string }>;
}) {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  // TEAMLY redirects back here with ?code=… after authorizing the integration;
  // pre-fill the connect form so the (long) code isn't copy-pasted by hand.
  const sp = await searchParams;
  const prefill = { code: typeof sp.code === 'string' ? sp.code : '', slug: typeof sp.slug === 'string' ? sp.slug : '' };

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
          <TeamlyIntegrationPanel status={status} prefill={prefill} />
        </CardContent>
      </Card>

      {status.connected && status.lastRuns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">История синхронизаций</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Начало</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Статей</th>
                  <th className="px-3 py-2 font-medium">Ошибки</th>
                </tr>
              </thead>
              <tbody>
                {status.lastRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2">
                      {new Date(r.startedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.itemsProcessed}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.errors || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Одностороннее зеркало: пространства и статьи TEAMLY импортируются в базу знаний (контент конвертируется из
        формата TEAMLY в markdown). Повторный запуск обновляет уже импортированные статьи. Умные таблицы и вложения —
        в следующих обновлениях интеграции.
      </p>
    </div>
  );
}
