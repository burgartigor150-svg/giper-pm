import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getEffectiveCaps } from '@/lib/capabilities';
import { getT } from '@/lib/i18n';
import { NewUserForm } from '@/components/domain/NewUserForm';

export default async function NewUserPage() {
  const me = await requireAuth();
  const caps = await getEffectiveCaps({ id: me.id, role: me.role });
  if (!caps.has('settings.users.manage')) notFound();
  const t = await getT('users');

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{t('newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewUserForm />
        </CardContent>
      </Card>
    </div>
  );
}
