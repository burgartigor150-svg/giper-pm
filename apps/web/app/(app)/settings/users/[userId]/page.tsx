import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getUserById } from '@/lib/users';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { EditUserForm } from '@/components/domain/EditUserForm';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();
  const t = await getT('users');

  const { userId } = await params;
  let user;
  try {
    user = await getUserById(userId);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{t('actions.edit')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EditUserForm
            user={{
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              image: user.image,
              isActive: user.isActive,
              timezone: user.timezone,
            }}
            isSelf={user.id === me.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
