import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { NewUserForm } from '@/components/domain/NewUserForm';

export default async function NewUserPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();
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
