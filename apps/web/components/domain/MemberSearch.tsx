'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';
import { searchUsers, type UserSearchHit } from '@/actions/users';
import { addProjectMemberAction } from '@/actions/projects';

type Role = 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER';
const ROLES: Role[] = ['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER'];

type Props = {
  projectId: string;
  excludeUserIds: string[];
};

export function MemberSearch({ projectId, excludeUserIds }: Props) {
  const t = useT('projects.settings');
  const tRoles = useT('projects.memberRole');
  const tErr = useT('projects.errors');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Debounced search on query change
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const hits = await searchUsers(trimmed);
      setResults(hits.filter((h) => !excludeUserIds.includes(h.id)));
      setOpen(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, excludeUserIds]);

  function handleAdd(userId: string, role: Role) {
    setError(null);
    startTransition(async () => {
      const res = await addProjectMemberAction(projectId, { userId, role });
      if (!res.ok) {
        const code = res.error.code;
        const known: Record<string, true> = {
          CONFLICT: true,
          INSUFFICIENT_PERMISSIONS: true,
          VALIDATION: true,
        };
        setError(known[code] ? tErr(code as 'CONFLICT' | 'INSUFFICIENT_PERMISSIONS' | 'VALIDATION') : res.error.message);
        return;
      }
      setQuery('');
      setResults([]);
      setOpen(false);
    });
  }

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-2">
      <label className="text-sm font-medium">{t('addMember')}</label>
      <Input
        type="search"
        placeholder={t('search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {query.trim().length > 0 && query.trim().length < 2 ? (
        <p className="text-xs text-muted-foreground">{t('searchHint')}</p>
      ) : null}

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-[5.25rem] z-30 max-h-72 overflow-y-auto rounded-md border border-border bg-background shadow-md">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</div>
          ) : (
            <ul>
              {results.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <Avatar src={u.image} alt={u.name} className="h-7 w-7" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                  </div>
                  <RoleAddButtons
                    pending={pending}
                    onPick={(role) => handleAdd(u.id, role)}
                    tRoles={tRoles}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function RoleAddButtons({
  pending,
  onPick,
  tRoles,
}: {
  pending: boolean;
  onPick: (role: Role) => void;
  tRoles: ReturnType<typeof useT>;
}) {
  const [selected, setSelected] = useState<Role>('CONTRIBUTOR');
  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value as Role)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {tRoles(r)}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={pending} onClick={() => onPick(selected)} type="button">
        +
      </Button>
    </div>
  );
}
