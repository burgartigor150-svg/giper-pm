import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { getT } from '@/lib/i18n';

export default async function SettingsPage() {
  const user = await requireAuth();
  if (!canSeeSettings({ id: user.id, role: user.role })) notFound();
  const t = await getT('settings');
  const tUsers = await getT('users');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
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
              <CardTitle>Интеграции</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href="/settings/integrations/bitrix24"
                className="text-sm underline"
              >
                Bitrix24 →
              </Link>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
