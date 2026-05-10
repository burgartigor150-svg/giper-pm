import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { prisma } from '@giper/db';
import { GenerateTgPairingCodeForm } from '@/components/domain/GenerateTgPairingCodeForm';
import { MiniAppUrlBlock } from '@/components/domain/MiniAppUrlBlock';
import { miniAppUrl } from '@/lib/siteOrigin';

export const dynamic = 'force-dynamic';

export default async function TelegramIntegrationPage() {
  const me = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { tgChatId: true, tgUsername: true },
  });

  const webAppUrl = miniAppUrl();
  const showSettingsLink = canSeeSettings({ id: me.id, role: me.role });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Telegram</h1>
        {showSettingsLink ? (
          <Link href="/settings" className="text-xs text-muted-foreground underline">
            К общим настройкам
          </Link>
        ) : null}
      </div>

      <Card className="border-blue-200/80 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardHeader>
          <CardTitle className="text-base">Если вы PM или участник команды</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Доступ к серверу и файлам репозитория <strong className="text-foreground">не нужен</strong>. Достаточно
            привязать аккаунт кодом ниже и пользоваться ботом или Mini App из Telegram.
          </p>
          <p>
            Не открывается вход из Telegram или пишет «не удалось войти» — передайте администратору ссылку из блока
            ниже и попросите проверить токен и BotFather (это делается один раз на всю организацию).
          </p>
        </CardContent>
      </Card>

      {me.role === 'ADMIN' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Для администратора (сервер и BotFather)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                В <code className="rounded bg-muted px-1">.env</code> у прод-сборки задать{' '}
                <code className="rounded bg-muted px-1">TG_BOT_TOKEN</code> и перезапустить контейнер{' '}
                <strong className="text-foreground">web</strong> (и сервис бота, если он есть в compose).
              </li>
              <li>
                В @BotFather → ваш бот → <strong className="text-foreground">Mini Apps</strong> указать URL ниже.
              </li>
              <li>
                <code className="rounded bg-muted px-1">AUTH_URL</code> на web должен совпадать с публичным HTTPS-доменом
                сайта.
              </li>
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mini App — ссылка для BotFather</CardTitle>
        </CardHeader>
        <CardContent>
          <MiniAppUrlBlock url={webAppUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Текущий статус</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {user?.tgChatId ? (
            <p>
              Привязан как{' '}
              <span className="font-medium">
                {user.tgUsername ? `@${user.tgUsername}` : `chat ${user.tgChatId}`}
              </span>
              . Чтобы перепривязать на другой чат — сгенерируй новый код ниже.
            </p>
          ) : (
            <p>Чат пока не привязан — без этого Mini App не сможет войти в вашу учётку.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {user?.tgChatId ? 'Перепривязать чат' : 'Привязать чат'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateTgPairingCodeForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Команды бота</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <code>/pair TG-…</code> — привязка лички (код с этой страницы)
          </p>
          <p>
            <code>/linkproj TG-…</code> — в группе: привязать чат к проекту (код со страницы проекта → Telegram)
          </p>
          <p>
            <code>/harvest</code> — собрать сообщения из привязанной группы в задачи
          </p>
          <p>
            <code>/me</code> — кто ты + текущий таймер
          </p>
          <p>
            <code>/today</code>, <code>/week</code> — сводка часов
          </p>
          <p>
            <code>/stop</code> — остановить активный live-таймер
          </p>
          <p>
            <code>/log 1.5 GFM-42 fixed bug</code> — записать время вручную
          </p>
          <p>
            <code>/help</code> — шпаргалка
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Запуск бота в проде: см.{' '}
        <Link
          href="https://github.com/burgartigor150-svg/giper-pm/blob/main/apps/tg-bot/README.md"
          className="underline"
        >
          apps/tg-bot/README.md
        </Link>
        . На сервере у контейнера <strong>web</strong> нужен тот же <code>TG_BOT_TOKEN</code>, что у бота.
      </p>
    </div>
  );
}
