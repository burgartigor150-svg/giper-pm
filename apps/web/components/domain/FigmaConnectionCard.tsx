'use client';

import { useState, useTransition } from 'react';
import { connectFigmaAction, disconnectFigmaAction } from '@/actions/figmaConnection';

/**
 * Admin card to connect/disconnect Figma via a personal access token. The token
 * is validated against the Figma API and stored encrypted server-side; only a
 * masked hint is ever shown back.
 */
export function FigmaConnectionCard({
  connected,
  hint,
}: {
  connected: boolean;
  hint: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState('');

  function connect() {
    const t = token.trim();
    if (!t) return;
    startTransition(async () => {
      const res = await connectFigmaAction(t);
      if (res.ok) {
        setToken('');
        location.reload();
      } else {
        alert(res.error.message);
      }
    });
  }

  function disconnect() {
    if (!confirm('Отключить Figma? Превью-эмбеды останутся, но миниатюры и синк комментариев перестанут работать.')) return;
    startTransition(async () => {
      const res = await disconnectFigmaAction();
      if (res.ok) location.reload();
      else alert(res.error.message);
    });
  }

  if (connected) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>
          Подключено · токен <code>…{hint}</code>
        </span>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50 dark:border-neutral-700"
        >
          Отключить
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        Создайте Personal Access Token: figma.com → Settings → Security → Personal
        access tokens (права на чтение файлов и комментариев). Вставьте сюда —
        появятся миниатюры кадров, приватные файлы и синк комментариев.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') connect();
          }}
          placeholder="figd_…"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button
          type="button"
          onClick={connect}
          disabled={pending || !token.trim()}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          Подключить
        </button>
      </div>
    </div>
  );
}
