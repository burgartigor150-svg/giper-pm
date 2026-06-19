'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
} from '@/lib/webhooks/events';
import {
  createWebhookAction,
  deleteWebhookAction,
  updateWebhookAction,
} from '@/actions/webhooks';
import type { WebhookView } from '@/lib/webhooks/getWebhooks';

type Props = { projectId: string; initial: WebhookView[] };

export function WebhooksForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(WEBHOOK_EVENTS));
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  function toggleEvent(e: WebhookEvent) {
    setEvents((cur) => {
      const next = new Set(cur);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  }

  function create() {
    setError(null);
    setSecret(null);
    startTransition(async () => {
      const res = await createWebhookAction(projectId, url.trim(), [...events]);
      if (res.ok && res.data) {
        setSecret(res.data.secret);
        setUrl('');
        router.refresh();
      } else if (!res.ok) {
        setError(res.error.message);
      }
    });
  }

  function toggleActive(h: WebhookView) {
    startTransition(async () => {
      const res = await updateWebhookAction(h.id, h.url, h.events, !h.active);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteWebhookAction(id);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Исходящие вебхуки: при событии в проекте мы шлём POST с JSON на ваш URL.
        Тело подписано HMAC-SHA256 в заголовке <code>X-Giper-Signature: sha256=…</code>.
      </p>

      {initial.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {initial.map((h) => (
            <li key={h.id} className="flex flex-col gap-1 rounded-md border border-input bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.url}</span>
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={h.active}
                    onChange={() => toggleActive(h)}
                    disabled={pending}
                  />
                  Активен
                </label>
                <button
                  type="button"
                  aria-label="Удалить вебхук"
                  onClick={() => remove(h.id)}
                  disabled={pending}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {h.events.map((e) => (
                  <span key={e} className="rounded bg-muted px-1.5 py-0.5">
                    {WEBHOOK_EVENT_LABELS[e as WebhookEvent] ?? e}
                  </span>
                ))}
                {h.lastFiredAt ? (
                  <span
                    className={
                      h.lastError
                        ? 'ml-auto text-destructive'
                        : 'ml-auto text-emerald-600'
                    }
                    title={h.lastError ?? ''}
                  >
                    {h.lastError ? `ошибка: ${h.lastError}` : `ок (${h.lastStatus})`}
                  </span>
                ) : (
                  <span className="ml-auto text-muted-foreground">ещё не срабатывал</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Вебхуков пока нет.</p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
          placeholder="https://example.com/giper-webhook"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
        <div className="flex flex-wrap gap-3">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={events.has(e)}
                onChange={() => toggleEvent(e)}
                disabled={pending}
              />
              {WEBHOOK_EVENT_LABELS[e]}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={create} disabled={pending || url.trim() === ''}>
            <Plus className="mr-1 h-4 w-4" />
            {pending ? 'Добавляю…' : 'Добавить вебхук'}
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
        {secret ? (
          <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Секрет для проверки подписи (показывается один раз — сохраните):
            <code className="mt-1 block break-all font-mono">{secret}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}
