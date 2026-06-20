'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { setCustomRoleActiveAction, deleteCustomRoleAction } from '@/actions/customRoles';

/** Enable/disable + delete controls for one role in the list. */
export function RoleRowActions({
  roleId,
  isActive,
  name,
  assignedCount,
}: {
  roleId: string;
  isActive: boolean;
  name: string;
  assignedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const res = await setCustomRoleActiveAction(roleId, !isActive);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    const warn = assignedCount > 0
      ? `Удалить роль «${name}»? ${assignedCount} пользователь(ей) вернутся к базовой роли.`
      : `Удалить роль «${name}»?`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(warn)) return;
    startTransition(async () => {
      const res = await deleteCustomRoleAction(roleId);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggleActive}>
        {isActive ? 'Выключить' : 'Включить'}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={remove}>
        Удалить
      </Button>
    </span>
  );
}
