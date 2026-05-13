import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getUserById } from '@/lib/users';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { EditUserForm } from '@/components/domain/EditUserForm';
import { UserPositionsForm } from '@/components/domain/UserPositionsForm';
import { SyncUserFromBitrixButton } from '@/components/domain/SyncUserFromBitrixButton';

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
    <div className="mx-auto max-w-md space-y-4">
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
            hasPositions={user.positions.length > 0}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Должности</CardTitle>
        </CardHeader>
        <CardContent>
          <UserPositionsForm
            userId={user.id}
            initial={user.positions.map((p) => ({
              position: p.position,
              primary: p.primary,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bitrix24</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-xs text-muted-foreground">
            {user.bitrixUserId ? (
              <>
                Связан с Bitrix24 ID:{' '}
                <span className="font-mono">{user.bitrixUserId}</span>
              </>
            ) : (
              <>
                Не связан с Bitrix24. Нажмите кнопку ниже — система найдёт по
                email <span className="font-mono">{user.email}</span> и подтянет
                ID, имя, аватар, часовой пояс.
              </>
            )}
          </div>
          <SyncUserFromBitrixButton
            userId={user.id}
            alreadyLinked={!!user.bitrixUserId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
