import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getEffectiveCaps } from '@/lib/capabilities';
import { getUserGroup } from '@/lib/groups/getUserGroups';
import { listUsers } from '@/lib/users';
import { GroupSettingsForm } from '@/components/domain/groups/GroupSettingsForm';
import { GroupMembersForm } from '@/components/domain/groups/GroupMembersForm';

export default async function UserGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const me = await requireAuth();
  const caps = await getEffectiveCaps({ id: me.id, role: me.role });
  if (!caps.has('settings.groups.manage')) notFound();

  const { groupId } = await params;
  const [group, users] = await Promise.all([getUserGroup(groupId), listUsers({})]);
  if (!group) notFound();

  const allUsers = users.map((u) => ({ id: u.id, name: u.name, email: u.email }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings/groups" className="text-sm text-muted-foreground hover:underline">
          ← Группы
        </Link>
        <h1 className="text-xl font-semibold">{group.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Настройки группы</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupSettingsForm
            groupId={group.id}
            initialName={group.name}
            initialDescription={group.description}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Участники ({group.memberIds.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupMembersForm
            groupId={group.id}
            allUsers={allUsers}
            memberIds={group.memberIds}
          />
        </CardContent>
      </Card>
    </div>
  );
}
