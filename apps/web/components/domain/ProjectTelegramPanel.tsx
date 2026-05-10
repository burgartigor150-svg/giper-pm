'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import {
  generateProjectTelegramLinkCodeAction,
  unlinkProjectTelegramChatAction,
} from '@/actions/projectTelegram';
import { harvestProjectChatAction } from '@/actions/telegramBots';

type LinkRow = {
  id: string;
  telegramChatId: string;
  chatTitle: string | null;
  createdAt: Date;
  bot: { botUsername: string };
  _count: { ingestMessages: number };
};

export function ProjectTelegramPanel({
  projectKey,
  initialLinks,
  hasBot,
}: {
  projectKey: string;
  initialLinks: LinkRow[];
  hasBot: boolean;
}) {
  const [links, setLinks] = useState(initialLinks);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ text: string; expiresAt: number; botUsername: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function mint() {
    setErr(null);
    setCode(null);
    startTransition(async () => {
      try {
        const r = await generateProjectTelegramLinkCodeAction(projectKey);
        setCode({ text: r.code, expiresAt: r.expiresAt, botUsername: r.botUsername });
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  }

  function unlink(id: string) {
    setErr(null);
    startTransition(async () => {
      const r = await unlinkProjectTelegramChatAction(projectKey, id);
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setLinks((prev) => prev.filter((x) => x.id !== id));
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Привязать чат</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasBot ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Сначала{' '}
              <a href="/integrations/telegram" className="font-medium underline">
                подключите своего Telegram-бота
              </a>
              . Без него код привязки не на что выпускать.
            </p>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={mint}>
              Сгенерировать код на 10 минут
            </Button>
          )}
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          {code ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="font-mono text-lg font-semibold">{code.text}</div>
              <p className="mt-2 text-muted-foreground">
                В групповом чате (где сидит{' '}
                <a
                  className="text-blue-700 underline"
                  href={`https://t.me/${code.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{code.botUsername}
                </a>
                ) отправьте боту:{' '}
                <code className="text-foreground">/linkproj {code.text}</code>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Действителен до {new Date(code.expiresAt).toLocaleString('ru-RU')}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Привязанные чаты ({links.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока ни один чат не привязан.</p>
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <div className="font-medium">{l.chatTitle ?? 'Без названия'}</div>
                    <div className="font-mono text-xs text-muted-foreground">{l.telegramChatId}</div>
                    <div className="text-xs text-muted-foreground">
                      Бот: @{l.bot.botUsername} · сообщений в буфере: {l._count.ingestMessages}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <HarvestButtonInline linkId={l.id} />
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => unlink(l.id)}>
                      Отвязать
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function HarvestButtonInline({ linkId }: { linkId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setErr(null);
          startTransition(async () => {
            const r = await harvestProjectChatAction({ linkId, limit: 25 });
            if (!r.ok) {
              setErr(r.message);
              return;
            }
            if (r.emptyBuffer) {
              setResult('Буфер пуст.');
              return;
            }
            setResult(`Создано задач: ${r.created.length}`);
          });
        }}
      >
        {pending ? 'Собираю…' : 'Собрать в задачи'}
      </Button>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
      {result ? <p className="text-xs text-emerald-700">{result}</p> : null}
    </div>
  );
}
