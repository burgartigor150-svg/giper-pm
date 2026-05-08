import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@giper/db';
import { GenerateTgPairingCodeForm } from '@/components/domain/GenerateTgPairingCodeForm';

/**
 * Telegram pairing landing — single button that mints a 5-min code,
 * shows it, and links to @<bot> with the prefilled `/start TG-XXXXXX`.
 *
 * The code itself lives in Redis (set by the server action). The bot
 * reads it via /pair, sets User.tgChatId, deletes the code.
 */
export const dynamic = 'force-dynamic';

export default async function TelegramIntegrationPage() {
  const me = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { tgChatId: true, tgUsername: true },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Telegram</h1>

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
            <p>Чат пока не привязан.</p>
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
          <p><code>/me</code> — кто ты + текущий таймер</p>
          <p><code>/today</code>, <code>/week</code> — сводка часов</p>
          <p><code>/stop</code> — остановить активный live-таймер</p>
          <p><code>/log 1.5 GFM-42 fixed bug</code> — записать время вручную</p>
          <p><code>/help</code> — повторить шпаргалку</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Бот ещё не выкатан в проде. См.{' '}
        <Link
          href="https://github.com/burgartigor150-svg/giper-pm/blob/main/apps/tg-bot/README.md"
          className="underline"
        >
          apps/tg-bot/README.md
        </Link>{' '}
        для активации.
      </p>
    </div>
  );
}
