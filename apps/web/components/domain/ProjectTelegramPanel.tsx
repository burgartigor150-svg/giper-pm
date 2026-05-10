'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import {
  generateProjectTelegramLinkCodeAction,
  unlinkProjectTelegramChatAction,
} from '@/actions/projectTelegram';

type LinkRow = {
  id: string;
  telegramChatId: string;
  chatTitle: string | null;
  createdAt: Date;
  _count: { ingestMessages: number };
};

export function ProjectTelegramPanel({
  projectKey,
  initialLinks,
}: {
  projectKey: string;
  initialLinks: LinkRow[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ text: string; expiresAt: number; bot: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function mint() {
    setErr(null);
    startTransition(async () => {
      try {
        const r = await generateProjectTelegramLinkCodeAction(projectKey);
        setCode({ text: r.code, expiresAt: r.expiresAt, bot: r.botUsername });
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
          <Button type="button" size="sm" disabled={pending} onClick={mint}>
            Сгенерировать код на 10 минут
          </Button>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          {code ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="font-mono text-lg font-semibold">{code.text}</div>
              <p className="mt-2 text-muted-foreground">
                В группе отправьте боту:{' '}
                <code className="text-foreground">
                  /linkproj {code.text}
                </code>
              </p>
              {code.bot ? (
                <p className="mt-1 text-xs">
                  Бот:{' '}
                  <a
                    className="text-blue-700 underline"
                    href={`https://t.me/${code.bot}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{code.bot}
                  </a>
                </p>
              ) : null}
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
                      Сообщений в буфере: {l._count.ingestMessages}
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => unlink(l.id)}>
                    Отвязать
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
