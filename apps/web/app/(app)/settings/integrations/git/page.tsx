import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';

/**
 * Admin-only setup guide for the GitHub / GitLab task integrations. Both are
 * webhook-fed: a `KEY-N` task reference in a commit message, branch, or
 * PR/MR title/description links it to the task automatically. This page just
 * surfaces the endpoint URLs + which env secret to set; nothing here mutates
 * state (the secrets live in the server env).
 */
export const dynamic = 'force-dynamic';

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
        ok ? 'bg-green-100 text-green-700' : 'bg-neutral-200 text-neutral-700'
      }`}
    >
      {ok ? 'Настроен' : 'Не настроен'}
    </span>
  );
}

export default async function GitIntegrationPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'pm.example.ru';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const base = `${proto}://${host}`;

  const githubOk = !!process.env.GITHUB_WEBHOOK_SECRET?.trim();
  const gitlabOk = !!process.env.GITLAB_WEBHOOK_SECRET?.trim();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Git — GitHub и GitLab</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Как это работает</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Упомяните номер задачи в формате <code>КЛЮЧ-НОМЕР</code> (например{' '}
          <code>GIPER-42</code>) в сообщении коммита, названии ветки, заголовке
          или описании PR/MR — связь с задачей появится автоматически, а на
          странице задачи будет виден статус (открыт / черновик / влит /
          закрыт). Коммиты добавляются внутренним комментарием.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            GitHub <StatusBadge ok={githubOk} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          <p className="text-muted-foreground">
            Repo → Settings → Webhooks → Add webhook:
          </p>
          <p>
            URL: <code>{base}/api/webhooks/github</code>
          </p>
          <p>Content-Type: <code>application/json</code></p>
          <p>
            Secret: переменная окружения <code>GITHUB_WEBHOOK_SECRET</code>
          </p>
          <p>События: <code>Push</code> + <code>Pull requests</code></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            GitLab <StatusBadge ok={gitlabOk} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          <p className="text-muted-foreground">
            Project (или Group) → Settings → Webhooks → Add new webhook:
          </p>
          <p>
            URL: <code>{base}/api/webhooks/gitlab</code>
          </p>
          <p>
            Secret token: переменная окружения <code>GITLAB_WEBHOOK_SECRET</code>
          </p>
          <p>
            Triggers: <code>Push events</code> + <code>Merge request events</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
