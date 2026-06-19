'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { createApiTokenAction, revokeApiTokenAction } from '@/actions/apiTokens';
import type { ApiTokenView } from '@/lib/api/getApiTokens';

type Props = { initial: ApiTokenView[] };

export function ApiTokensForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  function create() {
    setError(null);
    setFreshToken(null);
    startTransition(async () => {
      const res = await createApiTokenAction(name.trim());
      if (res.ok && res.data) {
        setFreshToken(res.data.token);
        setName('');
        router.refresh();
      } else if (!res.ok) {
        setError(res.error.message);
      }
    });
  }

  function revoke(id: string) {
    if (!confirm('Отозвать токен? Приложения с ним перестанут работать.')) return;
    startTransition(async () => {
      const res = await revokeApiTokenAction(id);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Токены для публичного REST API. Запросы с токеном действуют от вашего имени
        (видимость — ваша). Передавайте в заголовке{' '}
        <code>Authorization: Bearer gpm_…</code>. Пример:{' '}
        <code>GET /api/public/v1/projects</code>.
      </p>

      {initial.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {initial.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{t.name}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{t.prefix}</span>
                {t.revokedAt ? (
                  <span className="ml-2 text-xs text-destructive">отозван</span>
                ) : t.lastUsedAt ? (
                  <span className="ml-2 text-xs text-muted-foreground">использован</span>
                ) : (
                  <span className="ml-2 text-xs text-muted-foreground">не использован</span>
                )}
              </div>
              {!t.revokedAt ? (
                <button
                  type="button"
                  aria-label="Отозвать токен"
                  onClick={() => revoke(t.id)}
                  disabled={pending}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Токенов пока нет.</p>
      )}

      {freshToken ? (
        <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Новый токен (показывается один раз — скопируйте сейчас):
          <code className="mt-1 block break-all font-mono">{freshToken}</code>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={80}
          placeholder="Название (например: CI-бот)"
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
        />
        <Button type="button" size="sm" onClick={create} disabled={pending || name.trim() === ''}>
          <Plus className="mr-1 h-4 w-4" />
          {pending ? 'Создаю…' : 'Создать токен'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
