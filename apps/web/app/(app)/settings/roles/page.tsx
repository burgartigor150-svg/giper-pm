import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { listCustomRoles } from '@/lib/customRoles';
import { RoleRowActions } from '@/components/domain/roles/RoleRowActions';

export const dynamic = 'force-dynamic';

/** Admin-only: define org-level custom roles (capability sets). */
export default async function CustomRolesPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const roles = await listCustomRoles();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Настройки</Link>
        <h1 className="text-xl font-semibold">Роли</h1>
        <Link
          href="/settings/roles/new"
          className="ml-auto inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Новая роль
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Кастомная роль — это точный набор прав на уровне организации. Назначается
        пользователю на его странице и <b>заменяет</b> права его базовой роли
        (может и расширять, и ограничивать). Права уровня проекта не затрагиваются.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Роли ({roles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ролей пока нет. Создайте первую.</p>
          ) : (
            <ul className="divide-y">
              {roles.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={`/settings/roles/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    {!r.isActive ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">выключена</span> : null}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {r.scope === 'PROJECT' ? 'проект' : 'организация'}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      база {r.baseRole} · {r.capabilities.length} прав · {r.assignedCount} польз.
                    </span>
                  </span>
                  <RoleRowActions roleId={r.id} isActive={r.isActive} name={r.name} assignedCount={r.assignedCount} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
