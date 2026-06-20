'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { assignCustomRoleAction } from '@/actions/customRoles';

/**
 * Assign / change / clear a user's ORG custom role. Empty option = base role
 * (no override). One role per user.
 */
export function AssignRoleControl({
  userId,
  currentRoleId,
  roles,
}: {
  userId: string;
  currentRoleId: string | null;
  roles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState<string>(currentRoleId ?? '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await assignCustomRoleAction(userId, roleId || null);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  const dirty = (roleId || null) !== (currentRoleId ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          disabled={pending}
          aria-label="Кастомная роль"
          className="h-9 min-w-[14rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Базовая роль (без переопределения)</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={pending || !dirty} onClick={save}>
          {pending ? 'Сохраняю…' : 'Применить'}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        Кастомная роль заменяет права базовой роли организации (расширяет или ограничивает).
      </p>
    </div>
  );
}
