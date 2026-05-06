'use client';

import { useTransition } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import { removeProjectMemberAction } from '@/actions/projects';

type Props = {
  projectId: string;
  member: {
    id: string;
    role: 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER';
    user: { id: string; name: string; email: string; image: string | null };
  };
  isOwner: boolean;
};

export function MemberRow({ projectId, member, isOwner }: Props) {
  const t = useT('projects.settings');
  const tRoles = useT('projects.memberRole');
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      await removeProjectMemberAction(projectId, member.user.id);
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
      <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{tRoles(member.role)}</span>
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
