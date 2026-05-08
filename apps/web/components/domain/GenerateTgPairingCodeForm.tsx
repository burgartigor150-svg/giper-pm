'use client';

import { useCallback, useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { generateTgPairingCodeAction } from '@/actions/telegram';

type CodeState = {
  code: string;
  expiresAt: number;
  botUsername: string | null;
};

export function GenerateTgPairingCodeForm() {
  const [state, setState] = useState<CodeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generateTgPairingCodeAction();
        setState(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  }, []);

  return (
    <div className="space-y-3">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? 'Генерирую…' : 'Сгенерировать код'}
      </Button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {state ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
          <p>
            Код: <code className="text-base font-semibold">{state.code}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            Действует до{' '}
            {new Date(state.expiresAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p>
            Открой в Telegram{' '}
            {state.botUsername ? (
              <a
                href={`https://t.me/${state.botUsername}?start=${state.code}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                @{state.botUsername}
              </a>
            ) : (
              <span className="font-medium">бота giper-pm</span>
            )}{' '}
            и пришли:
          </p>
          <pre className="rounded bg-background p-2 text-xs">
            /pair {state.code}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
