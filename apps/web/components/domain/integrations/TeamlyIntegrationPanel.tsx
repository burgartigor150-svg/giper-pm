'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, Link2, Unlink } from 'lucide-react';
import { connectTeamlyAction, disconnectTeamlyAction, runTeamlySyncAction } from '@/actions/teamlyIntegration';
import type { TeamlyStatus } from '@/lib/integrations/teamly';

const input =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700';

export function TeamlyIntegrationPanel({
  status,
  prefill,
}: {
  status: TeamlyStatus;
  prefill?: { code?: string; slug?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(status.lastSyncSummary ?? null);
  const [form, setForm] = useState({
    slug: prefill?.slug ?? status.slug ?? '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    code: prefill?.code ?? '',
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function connect() {
    setError(null);
    startTransition(async () => {
      const res = await connectTeamlyAction(form);
      if (!res.ok) { setError(res.error.message); return; }
      router.refresh();
    });
  }

  function disconnect() {
    if (!confirm('Отключить интеграцию TEAMLY? Импортированные статьи останутся.')) return;
    startTransition(async () => {
      await disconnectTeamlyAction();
      router.refresh();
    });
  }

  async function sync() {
    setError(null);
    setSyncing(true);
    try {
      const res = await runTeamlySyncAction();
      if (!res.ok) setError(res.error.message);
      else { setNote(res.data?.summary ?? 'Готово'); router.refresh(); }
    } finally {
      setSyncing(false);
    }
  }

  if (!status.connected) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Создайте «Интеграцию» в TEAMLY (Настройки → Интеграции и внешние API), затем вставьте её параметры и
          ключ авторизации (<code>code</code>). Импорт односторонний: TEAMLY → база знаний.
        </p>
        {prefill?.code ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <code>code</code> подхвачен из ссылки перенаправления — заполните остальные поля и нажмите «Подключить».
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            slug аккаунта
            <input className={input} value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="your-slug" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            redirect_uri
            <input className={input} value={form.redirectUri} onChange={(e) => set('redirectUri', e.target.value)} placeholder="https://…" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            client_id
            <input className={input} value={form.clientId} onChange={(e) => set('clientId', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            client_secret
            <input className={input} type="password" value={form.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            code (ключ авторизации)
            <input className={input} value={form.code} onChange={(e) => set('code', e.target.value)} />
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={connect}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Подключить
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Подключено: <span className="font-medium text-foreground">{status.slug}</span> · {status.clusterDomain}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sync}
          disabled={syncing || pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Синхронизировать сейчас
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending || syncing}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          <Unlink className="h-4 w-4" /> Отключить
        </button>
      </div>
      {note ? <p className="text-muted-foreground">Последняя синхронизация: {note}</p> : null}
      {error ? <p className="text-red-600">{error}</p> : null}
    </div>
  );
}
