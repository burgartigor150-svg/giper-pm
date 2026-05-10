'use client';

import { useState } from 'react';
import { Button } from '@giper/ui/components/Button';

export function MiniAppUrlBlock({ url }: { url: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  }

  const isAbsolute = url.startsWith('http');

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Укажите этот URL в @BotFather как <strong className="text-foreground">Menu Button</strong> или{' '}
        <strong className="text-foreground">Mini App</strong> для бота. После привязки аккаунта через{' '}
        <code className="rounded bg-muted px-1">/pair</code> открытие из Telegram выполнит вход в giper-pm.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="max-w-full break-all rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
          {url}
        </code>
        {isAbsolute ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            {done ? 'Скопировано' : 'Копировать'}
          </Button>
        ) : (
          <span className="text-xs text-amber-700">
            Задайте AUTH_URL или NEXT_PUBLIC_APP_URL — иначе показан относительный путь.
          </span>
        )}
      </div>
      {isAbsolute ? (
        <p className="text-xs text-muted-foreground">
          Открыть в браузере (не из Telegram) для проверки страницы можно, но вход сработает только внутри клиента
          Telegram.
        </p>
      ) : null}
    </div>
  );
}
