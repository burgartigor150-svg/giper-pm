import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getUserGroups } from '@/lib/groups/getUserGroups';
import { CreateGroupForm } from '@/components/domain/groups/CreateGroupForm';

/** Admin-only: org-level user groups for bulk project add. */
export default async function UserGroupsPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const groups = await getUserGroups();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          ← Настройки
        </Link>
        <h1 className="text-xl font-semibold">Группы пользователей</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новая группа</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateGroupForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Группы ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Групп пока нет. Создайте первую — потом сможете добавить её целиком в любой проект.
            </p>
          ) : (
            <ul className="divide-y">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/settings/groups/${g.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{g.name}</div>
                      {g.description ? (
                        <div className="truncate text-xs text-muted-foreground">{g.description}</div>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                      {g.memberCount} чел.
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
