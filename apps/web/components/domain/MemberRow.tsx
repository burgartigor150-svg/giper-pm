'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import {
  removeProjectMemberAction,
  updateProjectMemberRoleAction,
} from '@/actions/projects';

type Role = 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER';
const ROLES: Role[] = ['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER'];

type Props = {
  projectId: string;
  member: {
    id: string;
    role: Role;
    user: { id: string; name: string; email: string; image: string | null };
  };
  isOwner: boolean;
};

export function MemberRow({ projectId, member, isOwner }: Props) {
  const router = useRouter();
  const t = useT('projects.settings');
  const tRoles = useT('projects.memberRole');
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const res = await removeProjectMemberAction(projectId, member.user.id);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      // Settings page server-renders the list; action revalidates only
      // /projects, so refresh the current route to drop the removed row.
      router.refresh();
    });
  }

  function handleRoleChange(role: Role) {
    if (role === member.role) return;
    startTransition(async () => {
      const res = await updateProjectMemberRoleAction(projectId, member.user.id, role);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-3 border-b border-border px-1 py-2 last:border-b-0">
      <Avatar src={member.user.image} alt={member.user.name} className="h-7 w-7" />
      <div className="flex flex-1 flex-col">
        <span className="text-sm">
          {member.user.name}
          {isOwner ? (
            <span className="ml-2 text-xs text-muted-foreground">({t('owner')})</span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">{member.user.email}</span>
      </div>
      {isOwner ? (
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{tRoles(member.role)}</span>
      ) : (
        <select
          value={member.role}
          disabled={pending}
          onChange={(e) => handleRoleChange(e.target.value as Role)}
          aria-label={t('role')}
          className="h-8 rounded-md border border-input bg-background px-1 text-xs"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{tRoles(r)}</option>
          ))}
        </select>
      )}
      {!isOwner ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={handleRemove}
        >
          {t('remove')}
        </Button>
      ) : null}
    </li>
  );
}
