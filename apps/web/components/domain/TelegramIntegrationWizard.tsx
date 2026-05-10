'use client';

import { useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import {
  connectTelegramBotAction,
  disconnectTelegramBotAction,
  harvestProjectChatAction,
} from '@/actions/telegramBots';
import { generateProjectTelegramLinkCodeAction } from '@/actions/projectTelegram';

export type WizardProject = {
  key: string;
  name: string;
};

export type WizardChatLink = {
  id: string;
  projectKey: string;
  projectName: string;
  chatTitle: string | null;
  telegramChatId: string;
  bufferedMessages: number;
  createdAt: string;
};

export type WizardBot = {
  id: string;
  botUsername: string;
  botName: string | null;
  isActive: boolean;
  lastError: string | null;
  lastPolledAt: string | null;
};

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-b border-border/60 pb-6 last:border-b-0 last:pb-0">
      <div
        className={
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ' +
          (done
            ? 'bg-emerald-600 text-white'
            : 'bg-foreground text-background')
        }
        aria-hidden
      >
        {done ? '✓' : n}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function ConnectBotForm({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const [token, setToken] = useState('');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const t = token.trim();
    if (!t) return;
    startTransition(async () => {
      const res = await connectTelegramBotAction({ token: t });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setToken('');
      onConnected();
    });
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <Input
        type="password"
        autoComplete="off"
        placeholder="1234567890:AA…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !token.trim()}>
          {pending ? 'Проверяю…' : 'Подключить бота'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Токен шифруется и доступен только серверу giper-pm.
        </span>
      </div>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
    </form>
  );
}

function DisconnectButton({ botId, onDone }: { botId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!confirm('Отключить бота? Все привязки чатов и буфер сообщений будут удалены.')) return;
          setErr(null);
          startTransition(async () => {
            const res = await disconnectTelegramBotAction({ botId });
            if (!res.ok) {
              setErr(res.message);
              return;
            }
            onDone();
          });
        }}
      >
        {pending ? '…' : 'Отключить бота'}
      </Button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
    </div>
  );
}

function GenerateCodeForProject({
  projectKey,
  botUsername,
  onGenerated,
}: {
  projectKey: string;
  botUsername: string;
  onGenerated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ text: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function mint() {
    setErr(null);
    setCode(null);
    startTransition(async () => {
      try {
        const r = await generateProjectTelegramLinkCodeAction(projectKey);
        setCode({ text: r.code, expiresAt: r.expiresAt });
        onGenerated();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" disabled={pending} onClick={mint}>
        {pending ? 'Генерирую…' : 'Сгенерировать код привязки'}
      </Button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {code ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            В групповом чате (где сидит @{botUsername}) отправьте боту:
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background px-2 py-1 font-mono text-sm">
            /linkproj {code.text}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Действует до {new Date(code.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function HarvestButton({ linkId }: { linkId: string }) {
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
              setResult('Буфер пуст — бот пока не получал сообщений (или они уже собраны).');
              return;
            }
            if (!r.created.length) {
              setResult('Не удалось создать задачи (пустые сообщения).');
              return;
            }
            setResult(
              `Создано задач: ${r.created.length}. Первые: ${r.created
                .slice(0, 5)
                .map((n) => `${r.projectKey}-${n}`)
                .join(', ')}`,
            );
          });
        }}
      >
        {pending ? 'Собираю…' : 'Собрать в задачи'}
      </Button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {result ? <p className="text-xs text-emerald-700">{result}</p> : null}
    </div>
  );
}

export function TelegramIntegrationWizard({
  bot,
  projects,
  links,
}: {
  bot: WizardBot | null;
  projects: WizardProject[];
  links: WizardChatLink[];
}) {
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.key ?? '');

  const stepBotDone = !!bot;
  const stepLinkDone = links.length > 0;
  const stepHarvestDone = links.some((l) => l.bufferedMessages > 0);

  function reload() {
    if (typeof window !== 'undefined') window.location.reload();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Подключите свой Telegram-бот</h1>
        <p className="text-sm text-muted-foreground">
          У giper-pm нет общего бота организации. Каждый PM подключает{' '}
          <strong className="text-foreground">собственного бота</strong> через @BotFather и привязывает его к чатам своих
          проектов. Сообщения из этих чатов превращаются в задачи.
        </p>
        {bot ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            Подключён бот <strong>@{bot.botUsername}</strong>
            {bot.botName ? ` (${bot.botName})` : ''}.
            {bot.lastError ? (
              <span className="ml-2 text-amber-800 dark:text-amber-300">⚠ {bot.lastError}</span>
            ) : null}
          </p>
        ) : (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Бот ещё не подключён. Пройдите шаги 1–3 — это займёт пару минут.
          </p>
        )}
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Шаги</CardTitle>
          <CardDescription>Делайте по порядку — каждое действие занимает 30 секунд.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-2">
          <Step n={1} title="Создайте бота в @BotFather" done={stepBotDone}>
            <p>
              Откройте{' '}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline"
              >
                @BotFather
              </a>{' '}
              в Telegram → отправьте команду <code className="rounded bg-muted px-1">/newbot</code> →
              придумайте имя и username (заканчивается на <code className="rounded bg-muted px-1">_bot</code>).
            </p>
            <p>
              BotFather пришлёт длинную строку вида{' '}
              <code className="rounded bg-muted px-1">1234567890:AA-Bb…</code> — это{' '}
              <strong className="text-foreground">токен</strong>, скопируйте его. Не показывайте никому.
            </p>
          </Step>

          <Step n={2} title="Отключите Group Privacy у бота" done={stepBotDone}>
            <p>
              Без этого бот видит только команды (которые начинаются с <code className="rounded bg-muted px-1">/</code>),
              но не обычные сообщения — и собирать задачи будет неоткуда.
            </p>
            <p>
              В @BotFather: <code className="rounded bg-muted px-1">/mybots</code> → выберите вашего бота →{' '}
              <strong className="text-foreground">Bot Settings</strong> →{' '}
              <strong className="text-foreground">Group Privacy</strong> →{' '}
              <strong className="text-foreground">Turn off</strong>.
            </p>
          </Step>

          <Step n={3} title="Вставьте токен сюда" done={stepBotDone}>
            {bot ? (
              <div className="space-y-2">
                <p className="text-emerald-800 dark:text-emerald-200">
                  Бот <strong>@{bot.botUsername}</strong> подключён. Токен зашифрован и больше не виден.
                </p>
                <DisconnectButton botId={bot.id} onDone={reload} />
              </div>
            ) : (
              <ConnectBotForm onConnected={reload} />
            )}
          </Step>

          <Step n={4} title="Добавьте бота в групповой чат проекта" done={stepBotDone && stepLinkDone}>
            {bot ? (
              <p>
                В Telegram откройте групповой чат вашего проекта (или создайте новый) → Manage group / Add member →{' '}
                найдите <strong className="text-foreground">@{bot.botUsername}</strong> и добавьте.
                Если бота не видно — он точно не отключал Group Privacy на шаге 2.
              </p>
            ) : (
              <p className="text-amber-700">Сначала подключите бота на шаге 3.</p>
            )}
          </Step>

          <Step n={5} title="Привяжите чат к проекту" done={stepLinkDone}>
            {!bot ? (
              <p className="text-amber-700">Сначала подключите бота.</p>
            ) : projects.length === 0 ? (
              <p className="text-amber-700">
                У вас пока нет проектов, в которых вы PM или владелец. Создайте проект, потом возвращайтесь сюда.
              </p>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Проект
                </label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} — {p.name}
                    </option>
                  ))}
                </select>
                {selectedProject ? (
                  <GenerateCodeForProject
                    projectKey={selectedProject}
                    botUsername={bot.botUsername}
                    onGenerated={reload}
                  />
                ) : null}
              </div>
            )}
          </Step>

          <Step n={6} title="Соберите сообщения в задачи" done={stepLinkDone && stepHarvestDone}>
            {links.length === 0 ? (
              <p>
                После привязки чата (шаг 5) сюда попадут все ваши группы. По кнопке «Собрать в задачи» giper-pm
                создаст по одной задаче на каждое непрочитанное сообщение.
              </p>
            ) : (
              <ul className="space-y-3">
                {links.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-md border border-border bg-background/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {l.chatTitle ?? 'Без названия'}{' '}
                          <span className="font-mono text-xs text-muted-foreground">({l.telegramChatId})</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Проект <span className="font-mono">{l.projectKey}</span> — {l.projectName}.{' '}
                          В буфере: {l.bufferedMessages}
                        </div>
                      </div>
                      <HarvestButton linkId={l.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs">
              То же самое можно делать прямо из Telegram командой{' '}
              <code className="rounded bg-muted px-1">/harvest 25</code>.
            </p>
          </Step>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Токен бота хранится зашифрованным (AES-256-GCM) и доступен только runner-у giper-pm. Ни админ инстанса, ни
        другие пользователи его не видят. Telegram сам по себе не даёт боту работать без токена — это техническое
        ограничение Telegram.
      </p>
    </div>
  );
}
