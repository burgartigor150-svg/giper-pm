import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getBitrix24SyncStatus } from '@/lib/integrations/bitrix24';
import { Bitrix24SyncButtons } from '@/components/domain/Bitrix24SyncButtons';

const STATUS_BADGE: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
};

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function fmtDuration(start: Date, end: Date | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return `${(ms / 1000).toFixed(1)}с`;
}

export default async function Bitrix24IntegrationPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const status = await getBitrix24SyncStatus();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Bitrix24</h1>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
            status.configured
              ? 'bg-green-100 text-green-700'
              : 'bg-neutral-200 text-neutral-700'
          }`}
        >
          {status.configured ? 'Настроен' : 'Не настроен'}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Подключение</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {status.configured ? (
            <p className="text-muted-foreground">
              URL входящего вебхука задан в <code>BITRIX24_WEBHOOK_URL</code>.
              Синхронизация — read-only зеркало: пользователи (по email),
              рабочие группы и задачи.
            </p>
          ) : (
            <p className="text-destructive">
              Переменная <code>BITRIX24_WEBHOOK_URL</code> не задана.
              Добавьте её в <code>apps/web/.env.local</code> и перезапустите
              сервер.
            </p>
          )}
        </CardContent>
      </Card>

      {status.configured ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Синхронизация</CardTitle>
          </CardHeader>
          <CardContent>
            <Bitrix24SyncButtons />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История запусков</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {status.lastRuns.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Запусков пока не было.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Начало</th>
                  <th className="px-3 py-2 font-medium">Длительность</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Записей</th>
                  <th className="px-3 py-2 font-medium">Ошибки</th>
                </tr>
              </thead>
              <tbody>
                {status.lastRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDateTime(r.startedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDuration(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          STATUS_BADGE[r.status] ?? 'bg-neutral-200 text-neutral-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.itemsProcessed}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.errors ? <code>{JSON.stringify(r.errors)}</code> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
