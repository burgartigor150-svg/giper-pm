'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
} from '@/actions/telegramBots';
import {
  generateProjectTelegramLinkCodeAction,
  pollProjectTelegramLinksAction,
} from '@/actions/projectTelegram';
import { createProjectQuickAction } from '@/actions/projects';
import { AiHarvestProposalsModal } from '@/components/domain/AiHarvestProposalsModal';

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
}: {
  projectKey: string;
  botUsername: string;
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ text: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [linkedChat, setLinkedChat] = useState<{ id: string; chatTitle: string | null } | null>(null);
  const baselineLinkIds = useRef<Set<string>>(new Set());

  function mint() {
    setErr(null);
    setLinkedChat(null);
    startTransition(async () => {
      try {
        // Snapshot existing links so we only react to NEW ones appearing
        // after this minted code (the user might have linked other chats
        // earlier in the same session). Failure here is non-fatal — we
        // just won't filter the baseline.
        try {
          const before = await pollProjectTelegramLinksAction(projectKey);
          if (before && before.ok) {
            baselineLinkIds.current = new Set(before.links.map((l) => l.id));
          }
        } catch {
          // ignore — polling will still work, just without baseline
        }
        const r = await generateProjectTelegramLinkCodeAction(projectKey);
        setCode({ text: r.code, expiresAt: r.expiresAt });
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  }

  // While we have a fresh code AND no link yet — poll every 4s for up
  // to 10 minutes (TTL of the code). Stop once we see a new link. Any
  // poll failure (cache miss, network blip, invalid session) is
  // swallowed so the polling loop keeps trying until the code expires.
  useEffect(() => {
    if (!code || linkedChat) return;
    if (Date.now() > code.expiresAt) return;
    let stopped = false;
    let timerId = 0;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await pollProjectTelegramLinksAction(projectKey);
        if (stopped) return;
        if (r && r.ok) {
          const fresh = r.links.find((l) => !baselineLinkIds.current.has(l.id));
          if (fresh) {
            setLinkedChat({ id: fresh.id, chatTitle: fresh.chatTitle });
            return;
          }
        }
      } catch {
        // swallow — try again on next tick
      }
      if (!stopped) timerId = window.setTimeout(tick, 4000);
    };
    timerId = window.setTimeout(tick, 4000);
    return () => {
      stopped = true;
      window.clearTimeout(timerId);
    };
  }, [code, linkedChat, projectKey]);

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" disabled={pending} onClick={mint}>
        {pending ? 'Генерирую…' : code ? 'Перевыпустить код' : 'Сгенерировать код привязки'}
      </Button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {code ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            В групповом чате (где сидит{' '}
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline"
            >
              @{botUsername}
            </a>
            ) отправьте боту:
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background px-2 py-1 font-mono text-sm">
            /linkproj {code.text}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Действует до{' '}
            {new Date(code.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
            Я слежу за этой страницей и подсвечу зелёным, как только бот привяжет чат — обновлять не нужно.
          </p>
        </div>
      ) : null}
      {linkedChat ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          ✓ Чат «<strong>{linkedChat.chatTitle ?? 'без названия'}</strong>» привязан к проекту. Переходите к шагу 6.
        </div>
      ) : null}
    </div>
  );
}

function CreateProjectInline({
  onCreated,
}: {
  onCreated: (project: { key: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);

  // Auto-suggest project key from name unless the user typed one explicitly.
  function deriveKey(n: string): string {
    const cleaned = n
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 5);
    return cleaned;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const finalKey = (keyTouched ? key : deriveKey(name)).trim().toUpperCase();
    const finalName = name.trim();
    if (!finalName) {
      setErr('Введите название проекта');
      return;
    }
    if (!/^[A-Z]{2,5}$/.test(finalKey)) {
      setErr('Ключ: 2–5 заглавных латинских букв (например GFM)');
      return;
    }
    startTransition(async () => {
      const r = await createProjectQuickAction({ key: finalKey, name: finalName });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      onCreated(r.project);
      setOpen(false);
      setName('');
      setKey('');
      setKeyTouched(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-foreground underline underline-offset-2"
      >
        + Создать новый проект
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-border bg-background/60 p-3"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Новый проект
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sm:col-span-2 space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground">Название</label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!keyTouched) setKey(deriveKey(e.target.value));
            }}
            placeholder="Команда продаж"
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground">Ключ (2-5 букв)</label>
          <Input
            value={key}
            onChange={(e) => {
              setKey(e.target.value.toUpperCase());
              setKeyTouched(true);
            }}
            placeholder="SALES"
            maxLength={5}
            disabled={pending}
            required
          />
        </div>
      </div>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? 'Создаю…' : 'Создать и выбрать'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
        >
          Отмена
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Задачи будут получать номера вида <code>{(keyTouched ? key : deriveKey(name)) || 'KEY'}-1</code>,{' '}
          <code>{(keyTouched ? key : deriveKey(name)) || 'KEY'}-2</code>…
        </span>
      </div>
    </form>
  );
}

function AnalyseButton({ linkId, chatTitle }: { linkId: string; chatTitle: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setToken((t) => t + 1);
          setOpen(true);
        }}
      >
        Анализ ИИ
      </Button>
      <AiHarvestProposalsModal
        open={open}
        onClose={() => setOpen(false)}
        linkId={linkId}
        chatTitle={chatTitle}
        triggerToken={token}
      />
    </>
  );
}

export function TelegramIntegrationWizard({
  bot,
  projects: initialProjects,
  links,
}: {
  bot: WizardBot | null;
  projects: WizardProject[];
  links: WizardChatLink[];
}) {
  // Local mirror so quick-create can append a new project and we
  // immediately switch the dropdown without a full page reload.
  const [projects, setProjects] = useState<WizardProject[]>(initialProjects);
  const [selectedProject, setSelectedProject] = useState<string>(initialProjects[0]?.key ?? '');

  const stepBotDone = !!bot;
  const stepLinkDone = links.length > 0;
  const stepHarvestDone = links.some((l) => l.bufferedMessages > 0);

  function reload() {
    if (typeof window !== 'undefined') window.location.reload();
  }

  function onProjectCreated(p: { key: string; name: string }) {
    setProjects((prev) =>
      prev.some((x) => x.key === p.key) ? prev : [{ key: p.key, name: p.name }, ...prev],
    );
    setSelectedProject(p.key);
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
            ) : (
              <div className="space-y-3">
                {projects.length === 0 ? (
                  <p className="text-amber-700">
                    У вас пока нет проектов, в которых вы PM или владелец. Создайте новый ниже —
                    или сначала на странице «Проекты», если нужны клиент/бюджет.
                  </p>
                ) : (
                  <div className="space-y-1">
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
                  </div>
                )}

                <CreateProjectInline onCreated={onProjectCreated} />

                {selectedProject ? (
                  <GenerateCodeForProject
                    projectKey={selectedProject}
                    botUsername={bot.botUsername}
                  />
                ) : null}
              </div>
            )}
          </Step>

          <Step n={6} title="Превратите сообщения в задачи (с ИИ)" done={stepLinkDone && stepHarvestDone}>
            {links.length === 0 ? (
              <p>
                После привязки чата (шаг 5) сюда попадут все ваши группы. ИИ прочитает накопленные
                сообщения, выкинет «ок/спасибо/стикеры», сгруппирует обсуждения и предложит готовые
                задачи (с описанием, типом, приоритетом, исполнителем и сроком). PM подтверждает или
                правит каждую перед созданием.
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
                      <AnalyseButton
                        linkId={l.id}
                        chatTitle={l.chatTitle ?? l.telegramChatId}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs">
              Файлы, прикреплённые к сообщениям (документы, картинки, голосовые), скачиваются и
              прикрепляются к создаваемой задаче автоматически.
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
