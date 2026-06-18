'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UsersRound } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { addGroupToProjectAction } from '@/actions/userGroups';

type Group = { id: string; name: string; memberCount: number };
type Role = 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER';

const ROLE_LABELS: Record<Role, string> = {
  LEAD: 'Лид',
  CONTRIBUTOR: 'Участник',
  REVIEWER: 'Ревьюер',
  OBSERVER: 'Наблюдатель',
};

/** Bulk-add a whole user group to the project's members. */
export function AddGroupToProject({ projectId, groups }: { projectId: string; groups: Group[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [role, setRole] = useState<Role>('CONTRIBUTOR');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Групп пользователей пока нет. Создайте их в{' '}
        <a href="/settings/groups" className="underline">
          Настройки → Группы пользователей
        </a>
        .
      </p>
    );
  }

  function add() {
    setMsg(null);
    setError(null);
    if (!groupId) return;
    startTransition(async () => {
      const res = await addGroupToProjectAction(groupId, projectId, role);
      if (res.ok) {
        setMsg(`Добавлено: ${res.data?.added ?? 0}`);
        router.refresh();
        setTimeout(() => setMsg(null), 2500);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <UsersRound className="h-4 w-4 text-muted-foreground" />
      <select
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        disabled={pending}
        aria-label="Группа"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.memberCount})
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        disabled={pending}
        aria-label="Роль"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={add} disabled={pending}>
        {pending ? 'Добавляю…' : 'Добавить группу'}
      </Button>
      {msg ? <span className="text-xs text-emerald-600">{msg}</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
