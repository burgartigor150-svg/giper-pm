'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { setGroupMembersAction } from '@/actions/userGroups';

type UserOption = { id: string; name: string; email: string };

type Props = {
  groupId: string;
  allUsers: UserOption[];
  memberIds: string[];
};

/** Toggle-list of all users; saving reconciles the group's full membership. */
export function GroupMembersForm({ groupId, allUsers, memberIds }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(memberIds));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [allUsers, query]);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await setGroupMembersAction(groupId, [...selected]);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или e-mail"
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          Выбрано: {selected.size}
        </span>
      </div>
      <ul className="max-h-80 divide-y overflow-auto rounded-md border">
        {filtered.map((u) => (
          <li key={u.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggle(u.id)}
                disabled={pending}
              />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{u.email}</span>
            </label>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">Никого не найдено.</li>
        ) : null}
      </ul>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить участников'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
