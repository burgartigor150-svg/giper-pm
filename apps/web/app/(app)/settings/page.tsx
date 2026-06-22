import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { getT } from '@/lib/i18n';
import { getSpaces } from '@/lib/spaces/getSpaces';
import { SpacesForm } from '@/components/domain/SpacesForm';

export default async function SettingsPage() {
  const user = await requireAuth();
  const caps = await getEffectiveCaps({ id: user.id, role: user.role });
  if (!canSeeSettings({ id: user.id, role: user.role }, caps)) notFound();
  const t = await getT('settings');
  const tUsers = await getT('users');
  const spaces = await getSpaces();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Пространства</CardTitle>
        </CardHeader>
        <CardContent>
          <SpacesForm initial={spaces} canManage={canSeeSettings({ id: user.id, role: user.role })} />
        </CardContent>
      </Card>

      {user.role === 'ADMIN' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tUsers('title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/settings/users" className="text-sm underline">
                {tUsers('title')} →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Группы пользователей</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/settings/groups" className="text-sm underline">
                Группы пользователей →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Роли</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/settings/roles" className="text-sm underline">
                Кастомные роли →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Интеграции</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Link
                href="/settings/integrations/bitrix24"
                className="text-sm underline"
              >
                Bitrix24 →
              </Link>
              <Link
                href="/settings/integrations/git"
                className="text-sm underline"
              >
                GitHub / GitLab (PR/MR в задачах) →
              </Link>
              <Link href="/integrations/telegram" className="text-sm underline">
                Telegram (личные боты PM) →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/settings/audit" className="text-sm underline">
                История действий →
              </Link>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
