import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { listUsers } from '@/lib/users';
import { getT } from '@/lib/i18n';

export default async function UsersPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const t = await getT('users');
  const tRoles = await getT('users.role');
  const tStatus = await getT('users.status');

  const users = await listUsers({ includeInactive: true });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Link href="/settings/users/new">
          <Button>{t('create')}</Button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t('table.name')}</th>
              <th className="px-4 py-2 font-medium">{t('table.email')}</th>
              <th className="px-4 py-2 font-medium">{t('table.role')}</th>
              <th className="px-4 py-2 font-medium">{t('table.status')}</th>
              <th className="px-4 py-2 font-medium">{t('table.created')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link href={`/settings/users/${u.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <Avatar src={u.image} alt={u.name} className="h-6 w-6" />
                    {u.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-2">{tRoles(u.role)}</td>
                <td className="px-4 py-2">
                  {!u.isActive ? (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs">
                      {tStatus('inactive')}
                    </span>
                  ) : u.mustChangePassword ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      {tStatus('mustChange')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      {tStatus('active')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
