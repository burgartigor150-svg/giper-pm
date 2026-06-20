import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getUserById } from '@/lib/users';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { EditUserForm } from '@/components/domain/EditUserForm';
import { UserPositionsForm } from '@/components/domain/UserPositionsForm';
import { SyncUserFromBitrixButton } from '@/components/domain/SyncUserFromBitrixButton';
import { AssignRoleControl } from '@/components/domain/roles/AssignRoleControl';
import { listAssignableRoles, getUserAssignment } from '@/lib/customRoles';
import { getMyCustomCaps, resolveEffectiveCaps, getEffectiveCaps } from '@/lib/capabilities';
import { CAPABILITY_GROUPS } from '@/lib/capabilities/catalog';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const me = await requireAuth();
  const myCaps = await getEffectiveCaps({ id: me.id, role: me.role });
  if (!myCaps.has('settings.users.manage')) notFound();
  const t = await getT('users');

  const { userId } = await params;
  let user;
  try {
    user = await getUserById(userId);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }

  // Custom-role assignment + the effective capabilities it resolves to (preview).
  const [assignableRoles, assignment, customCaps] = await Promise.all([
    listAssignableRoles(),
    getUserAssignment(user.id),
    getMyCustomCaps(user.id),
  ]);
  const effective = resolveEffectiveCaps({ id: user.id, role: user.role }, customCaps);
  const grantedByArea = CAPABILITY_GROUPS.map((g) => ({
    area: g.area,
    granted: g.capabilities.filter((c) => effective.has(c.key)).map((c) => c.label),
  })).filter((g) => g.granted.length > 0);

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
              crmAccess: user.crmAccess,
            }}
            isSelf={user.id === me.id}
            hasPositions={user.positions.length > 0}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Кастомная роль</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AssignRoleControl
            userId={user.id}
            currentRoleId={assignment?.roleId ?? null}
            roles={assignableRoles}
          />
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Эффективные права ({effective.source === 'custom' ? 'кастомная роль' : 'базовая роль'})
            </div>
            {grantedByArea.length === 0 ? (
              <p className="text-xs text-muted-foreground">Нет прав уровня организации.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {grantedByArea.map((g) => (
                  <li key={g.area}>
                    <span className="font-medium">{g.area}:</span>{' '}
                    <span className="text-muted-foreground">{g.granted.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
