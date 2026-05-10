'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { GenerateTgPairingCodeForm } from '@/components/domain/GenerateTgPairingCodeForm';
import { MiniAppUrlBlock } from '@/components/domain/MiniAppUrlBlock';

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-b border-border/60 pb-6 last:border-b-0 last:pb-0">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background"
        aria-hidden
      >
        {n}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function TelegramIntegrationWizard({
  linked,
  tgUsername,
  botUsername,
  showAdminBlocks,
  webAppUrl,
}: {
  linked: boolean;
  tgUsername: string | null;
  botUsername: string | null;
  showAdminBlocks: boolean;
  webAppUrl: string;
}) {
  const botHandle = botUsername ? `@${botUsername.replace(/^@/, '')}` : null;
  const botHref = botUsername ? `https://t.me/${botUsername.replace(/^@/, '')}` : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Подключите личный Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Вы связываете <strong className="text-foreground">свой</strong> аккаунт Telegram с учёткой giper-pm. Никаких
          API-ключей и доступа к серверу не нужно — только Telegram и эта страница.
        </p>
        {linked ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            Сейчас привязано:{' '}
            <strong>{tgUsername ? `@${tgUsername}` : 'Telegram подключён'}</strong>. Ниже можно перепривязать другой
            аккаунт.
          </p>
        ) : (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Пока не привязано. Пройдите шаги 1 → 3 — это займёт около минуты.
          </p>
        )}
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Шаги</CardTitle>
          <CardDescription>Делайте по порядку — так быстрее всего получится.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-2">
          <Step n={1} title="Откройте корпоративного бота в Telegram">
            <p>
              На телефоне или в Telegram Desktop найдите бота организации
              {botHandle ? (
                <>
                  :{' '}
                  <a
                    href={botHref!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline"
                  >
                    {botHandle}
                  </a>
                </>
              ) : (
                <> (имя бота подскажет администратор giper-pm).</>
              )}
            </p>
            <p>Нажмите «Запустить» / Start, если бот ещё не запускали.</p>
          </Step>

          <Step n={2} title="Вход через приложение в Telegram (по желанию)">
            <p>
              Если у бота в меню есть пункт вроде <strong className="text-foreground">«Открыть приложение»</strong> или
              Mini App — после привязки на шаге 3 вы сможете открывать giper-pm прямо из Telegram без пароля.
            </p>
            <p className="text-xs">Нет такой кнопки — не страшно, можно пользоваться только сайтом и командами бота.</p>
          </Step>

          <Step n={3} title="Привяжите учётку одноразовым кодом">
            <p>
              Нажмите кнопку ниже — появится код на несколько минут. Отправьте боту в <strong>личку</strong> команду
              ровно в том виде, как покажет система (начинается с <code className="rounded bg-muted px-1">/pair</code>
              ).
            </p>
            <GenerateTgPairingCodeForm buttonLabel="Получить код для привязки" />
          </Step>

          <Step n={4} title="Проверка">
            {linked ? (
              <p className="text-emerald-800 dark:text-emerald-200">
                Готово — Telegram подключён. Можно пользоваться командами бота и (если включено) Mini App.
              </p>
            ) : (
              <div className="space-y-2">
                <p>
                  После отправки <code className="rounded bg-muted px-1">/pair …</code> бот ответит подтверждением.
                  Обновите страницу — статус сверху станет зелёным.
                </p>
                <button
                  type="button"
                  className="text-sm font-medium text-foreground underline"
                  onClick={() => window.location.reload()}
                >
                  Обновить страницу
                </button>
              </div>
            )}
          </Step>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Что умеет бот после привязки</CardTitle>
          <CardDescription>Кратко — полный список можно вызвать командой /help у бота.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <code className="rounded bg-muted px-1">/me</code>, <code className="rounded bg-muted px-1">/today</code>,{' '}
            <code className="rounded bg-muted px-1">/week</code> — таймер и часы
          </p>
          <p>
            <code className="rounded bg-muted px-1">/log</code> — записать время на задачу
          </p>
          <p>
            В <strong className="text-foreground">групповом чате</strong> проекта (если вы PM/лид):{' '}
            <code className="rounded bg-muted px-1">/linkproj</code> и <code className="rounded bg-muted px-1">/harvest</code>{' '}
            — страница проекта → раздел «Telegram» подскажет код.
          </p>
        </CardContent>
      </Card>

      {showAdminBlocks ? (
        <>
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Только администратор инстанса</CardTitle>
              <CardDescription>
                Настройка один раз на организацию: сервер и BotFather. Обычным пользователям этот блок не нужен.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  В окружении контейнера <strong className="text-foreground">web</strong> задан токен бота и совпадает с
                  процессом бота на сервере.
                </li>
                <li>
                  В @BotFather → Mini Apps указан URL Mini App (скопируйте ниже).
                </li>
                <li>
                  Публичный адрес сайта совпадает с настройкой авторизации (<code className="rounded bg-muted px-1">AUTH_URL</code>
                  ).
                </li>
              </ol>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  URL для BotFather (Mini App)
                </div>
                <MiniAppUrlBlock url={webAppUrl} />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Техническая документация:{' '}
            <Link
              href="https://github.com/burgartigor150-svg/giper-pm/blob/main/apps/tg-bot/README.md"
              className="underline"
            >
              apps/tg-bot/README.md
            </Link>
          </p>
        </>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Не работает бот или Mini App? Обратитесь к администратору giper-pm в вашей организации — без ваших ключей и без
          доступа к серверу.
        </p>
      )}
    </div>
  );
}
