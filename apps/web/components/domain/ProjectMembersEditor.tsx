'use client';

import { useState, useTransition } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { X } from 'lucide-react';
import {
  addProjectMemberAction,
  removeProjectMemberAction,
} from '@/actions/projects';
import { UserPicker, type PickerUser } from './UserPicker';

type MemberRole = 'LEAD' | 'MEMBER' | 'VIEWER';

const ROLE_LABELS: Record<MemberRole, string> = {
  LEAD: 'Лид',
  MEMBER: 'Участник',
  VIEWER: 'Наблюдатель',
};

type Member = {
  id: string;
  role: MemberRole;
  userId: string;
  user: { id: string; name: string; email: string | null; image: string | null };
};

type Props = {
  projectId: string;
  members: Member[];
  canEdit: boolean;
};

export function ProjectMembersEditor({ projectId, members, canEdit }: Props) {
  const [list, setList] = useState(members);
  const [pickedUser, setPickedUser] = useState<PickerUser | null>(null);
  const [pickedRole, setPickedRole] = useState<MemberRole>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    if (!pickedUser) {
      setError('Выберите участника');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addProjectMemberAction(projectId, {
        userId: pickedUser.id,
        role: pickedRole,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      // Optimistic insert. Server will revalidate /projects too.
      setList((prev) => {
        if (prev.some((m) => m.userId === pickedUser.id)) return prev;
        return [
          ...prev,
          {
            id: `tmp-${pickedUser.id}`,
            role: pickedRole,
            userId: pickedUser.id,
            user: {
              id: pickedUser.id,
              name: pickedUser.name,
              email: pickedUser.email ?? null,
              image: pickedUser.image,
            },
          },
        ];
      });
      setPickedUser(null);
      setPickedRole('MEMBER');
    });
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      const res = await removeProjectMemberAction(projectId, userId);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setList((prev) => prev.filter((m) => m.userId !== userId));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2 text-sm">
        {list.length === 0 ? (
          <li className="text-xs italic text-muted-foreground">
            В проекте пока никого нет.
          </li>
        ) : (
          list.map((m) => (
            <li
              key={m.id}
              className="group flex items-center gap-3 rounded-md border border-border bg-background px-2 py-1.5"
            >
              <Avatar src={m.user.image} alt={m.user.name} className="h-7 w-7" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{m.user.name}</span>
                {m.user.email ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {m.user.email}
                  </span>
                ) : null}
              </div>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {ROLE_LABELS[m.role]}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  disabled={pending}
                  aria-label={`Убрать ${m.user.name}`}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canEdit ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Добавить участника
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <UserPicker
                value={pickedUser}
                placeholder="Найти пользователя…"
                onPick={(u) => setPickedUser(u)}
              />
            </div>
            <select
              value={pickedRole}
              onChange={(e) => setPickedRole(e.target.value as MemberRole)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="LEAD">Лид</option>
              <option value="MEMBER">Участник</option>
              <option value="VIEWER">Наблюдатель</option>
            </select>
            <Button
              type="button"
              size="sm"
              onClick={handleAdd}
              disabled={pending || !pickedUser}
            >
              Добавить
            </Button>
          </div>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
