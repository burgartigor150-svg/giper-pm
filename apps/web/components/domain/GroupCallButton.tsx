'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { searchUsers, type UserSearchHit } from '@/actions/users';
import { startGroupCallAction } from '@/actions/meetings';

/**
 * "Новый групповой звонок" — opens a small inline form: title + a
 * multi-select user picker (live search by name/email). Submit creates
 * the meeting with the chosen roster and navigates the caller into
 * /meetings/<id>. The invitees get the standard three-channel ping.
 *
 * Unlike CreateMeetingButton (PM/ADMIN only, no roster), this one is
 * open to any active user — it's the equivalent of "Start a Zoom" not
 * "Schedule a project meeting".
 */
export function GroupCallButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchHit[]>([]);
  const [picked, setPicked] = useState<UserSearchHit[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const hits = await searchUsers(q);
      const pickedIds = new Set(picked.map((p) => p.id));
      setResults(hits.filter((h) => !pickedIds.has(h.id)));
      setDropdownOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  function addUser(u: UserSearchHit) {
    setPicked((prev) => [...prev, u]);
    setQuery('');
    setResults([]);
    setDropdownOpen(false);
  }

  function removeUser(id: string) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (title.trim().length < 2) {
      setErr('Название слишком короткое');
      return;
    }
    if (picked.length === 0) {
      setErr('Выберите хотя бы одного участника');
      return;
    }
    startTransition(async () => {
      const r = await startGroupCallAction({
        title: title.trim(),
        participantUserIds: picked.map((p) => p.id),
      });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      router.push(`/meetings/${r.meetingId}`);
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        + Групповой звонок
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="gc-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Тема
        </label>
        <Input
          id="gc-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Например: дейли продакта"
          required
        />
      </div>

      <div ref={wrapRef} className="relative flex flex-col gap-1">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Участники
        </label>
        {picked.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {picked.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-2 rounded-full bg-muted px-2 py-1 text-xs"
              >
                <Avatar src={u.image} alt={u.name} className="h-5 w-5" />
                <span>{u.name}</span>
                <button
                  type="button"
                  onClick={() => removeUser(u.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Удалить"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          type="search"
          placeholder="Поиск по имени или email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setDropdownOpen(true)}
          autoComplete="off"
        />
        {dropdownOpen && query.trim().length >= 2 && results.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-background shadow-md">
            <ul>
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => addUser(u)}
                    className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                  >
                    <Avatar src={u.image} alt={u.name} className="h-7 w-7" />
                    <div className="flex flex-col">
                      <span className="text-sm">{u.name}</span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || picked.length === 0 || title.trim().length < 2}>
          {pending ? 'Создаю…' : `Позвонить (${picked.length})`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setTitle('');
            setPicked([]);
            setQuery('');
            setErr(null);
          }}
          disabled={pending}
        >
          Отмена
        </Button>
        {err ? <span className="text-xs text-destructive">{err}</span> : null}
      </div>
    </form>
  );
}
