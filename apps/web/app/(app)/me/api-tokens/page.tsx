import { headers } from 'next/headers';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getApiTokens } from '@/lib/api/getApiTokens';
import { ApiTokensForm } from '@/components/domain/ApiTokensForm';

/** /me/api-tokens — personal API tokens for the public REST API + MCP. */
export const dynamic = 'force-dynamic';

export default async function ApiTokensPage() {
  const me = await requireAuth();
  const tokens = await getApiTokens(me.id);

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'pm.since-b24-ru.ru';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const mcpUrl = `${proto}://${host}/api/mcp`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 md:px-6">
      <h1 className="text-2xl font-semibold">API-токены</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Личные токены</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiTokensForm initial={tokens} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">MCP-сервер (Claude / AI-агенты)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            Подключите giper-pm к Claude как MCP-сервер — он сможет читать и
            создавать задачи, менять статусы и комментировать (в рамках ваших
            прав). Используйте токен выше.
          </p>
          <p>
            URL: <code>{mcpUrl}</code>
          </p>
          <p className="text-muted-foreground">Claude Code:</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
            {`claude mcp add --transport http giper ${mcpUrl} \\
  --header "Authorization: Bearer ВАШ_ТОКЕН"`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Инструменты: list_projects, list_tasks, get_task, create_task,
            add_comment, set_status.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
