import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { prisma } from '@giper/db';
import { TelegramIntegrationWizard } from '@/components/domain/TelegramIntegrationWizard';
import { miniAppUrl } from '@/lib/siteOrigin';

export const dynamic = 'force-dynamic';

export default async function TelegramIntegrationPage() {
  const me = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { tgChatId: true, tgUsername: true },
  });

  const showSettingsLink = canSeeSettings({ id: me.id, role: me.role });
  const botUsername = process.env.PUBLIC_TG_BOT_USERNAME?.trim().replace(/^@/, '') || null;

  return (
    <>
      {showSettingsLink ? (
        <div className="mx-auto flex max-w-2xl justify-end px-6 pt-4">
          <Link href="/settings" className="text-xs text-muted-foreground underline">
            Общие настройки
          </Link>
        </div>
      ) : null}
      <TelegramIntegrationWizard
        linked={!!user?.tgChatId}
        tgUsername={user?.tgUsername ?? null}
        botUsername={botUsername}
        showAdminBlocks={me.role === 'ADMIN'}
        webAppUrl={miniAppUrl()}
      />
    </>
  );
}
