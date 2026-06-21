'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { assignProjectCustomRoleAction } from '@/actions/customRoles';

type Member = { id: string; name: string; image: string | null; currentRoleId: string | null };

/**
 * Per-member project-role assignment, shown in project settings. Each project
 * member gets a select of PROJECT-scope roles; choosing one grants its caps to
 * that member WITHIN this project only. Gated server-side on canEditProject for
 * this project (owner/LEAD/admin), and only members appear, so the membership
 * floor holds by construction.
 */
export function AssignProjectRoleControl({
  projectId,
  projectKey,
  members,
  roles,
}: {
  projectId: string;
  projectKey: string;
  members: Member[];
  roles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Проектных ролей пока нет. Создайте роль уровня «Проект» в{' '}
        <a href="/settings/roles" className="underline">Настройки → Роли</a>.
      </p>
    );
  }

  function setRole(userId: string, roleId: string) {
    setError(null);
    startTransition(async () => {
      const res = await assignProjectCustomRoleAction(projectId, userId, roleId || null, projectKey);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ul className="divide-y">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Avatar src={m.image} alt={m.name} className="h-6 w-6" />
              <span className="truncate">{m.name}</span>
            </span>
            <select
              value={m.currentRoleId ?? ''}
              disabled={pending}
              aria-label={`Проектная роль для ${m.name}`}
              onChange={(e) => setRole(m.id, e.target.value)}
              className="h-8 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Без проектной роли</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Проектная роль добавляет права только внутри этого проекта.
      </p>
    </div>
  );
}
