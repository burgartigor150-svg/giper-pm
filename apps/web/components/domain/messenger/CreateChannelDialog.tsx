'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, X } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import {
  createChannelAction,
  searchUsersForMention,
} from '@/actions/messenger';

type UserHit = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * Channel creation dialog.
 *
 * Centered modal with a darkening overlay — the previous inline
 * popover collided with the global sidebar in the narrow messenger
 * column. PRIVATE channels require ≥1 invitee (rejected server-side
 * otherwise); PUBLIC/BROADCAST allow zero. Closes on Esc or
 * overlay click.
 */
export function CreateChannelDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'PUBLIC' | 'PRIVATE' | 'BROADCAST'>('PUBLIC');
  const [picked, setPicked] = useState<UserHit[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setKind('PUBLIC');
    setPicked([]);
    setError(null);
  }

  // Close on Esc. Outside-click is handled by clicking the modal
  // overlay below (more reliable than a global mousedown listener,
  // which fires while the user is selecting text inside the dialog).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const canSubmit =
    !!name.trim() && (kind !== 'PRIVATE' || picked.length > 0) && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await createChannelAction({
        name,
        kind,
        memberUserIds: picked.map((u) => u.id),
      });
      if (res.ok && res.data) {
        setOpen(false);
        reset();
        router.push(`/messages/${res.data.id}`);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error.message);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Создать канал"
        aria-expanded={open}
      >
        <Plus className="size-4" />
      </button>
      {open ? (
        // Centered modal — overlay darkens the entire app (sidebar +
        // chat list included) so the dialog clearly owns the screen
        // and there's nothing else to click by accident.
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-foreground/40 p-3 pt-[6vh] md:p-4 md:pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Новый канал"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              reset();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-popover p-4 shadow-2xl">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Новый канал
            </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название…"
            className="mb-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoFocus
            maxLength={60}
          />
          <fieldset className="mb-2 flex flex-wrap gap-3 text-xs">
            <legend className="sr-only">Тип канала</legend>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={kind === 'PUBLIC'}
                onChange={() => setKind('PUBLIC')}
              />
              Публичный
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={kind === 'PRIVATE'}
                onChange={() => setKind('PRIVATE')}
              />
              Приватный
            </label>
            <label className="flex items-center gap-1.5" title="Только админ может писать">
              <input
                type="radio"
                checked={kind === 'BROADCAST'}
                onChange={() => setKind('BROADCAST')}
              />
              Канал (broadcast)
            </label>
          </fieldset>
          <div className="mb-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Участники
              {kind === 'PRIVATE' ? (
                <span className="ml-1 text-destructive" aria-hidden>
                  *
                </span>
              ) : null}
              {kind === 'PUBLIC' ? (
                <span className="ml-1 text-muted-foreground">(необязательно — кто угодно может присоединиться)</span>
              ) : null}
              {kind === 'BROADCAST' ? (
                <span className="ml-1 text-muted-foreground">(подписаться сможет любой — здесь только соавторы-админы)</span>
              ) : null}
            </label>
            <UserPicker picked={picked} onChange={setPicked} />
          </div>
          {error ? (
            <p className="mb-2 text-xs text-destructive">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pending ? 'Создаю…' : 'Создать'}
            </button>
          </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline searchable multi-pick user list. Type to filter the active
 * user roster, click a row to toggle. Selected users render as
 * dismissible chips above the search input.
 *
 * Lazy: doesn't load anything until the dropdown is opened (first
 * focus on the search input). Empty query lists the first 25 users
 * server-side ordered by active+name.
 */
function UserPicker({
  picked,
  onChange,
}: {
  picked: UserHit[];
  onChange: (next: UserHit[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [opened, setOpened] = useState(false);

  function load(q: string) {
    startTransition(async () => {
      const r = await searchUsersForMention(q);
      setResults(r);
    });
  }

  // Tiny debounce so we don't fire a network request per keystroke.
  useEffect(() => {
    if (!opened) return;
    const t = setTimeout(() => load(query), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, opened]);

  function toggle(u: UserHit) {
    if (picked.some((p) => p.id === u.id)) {
      onChange(picked.filter((p) => p.id !== u.id));
    } else {
      onChange([...picked, u]);
    }
  }

  return (
    <div>
      {picked.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {picked.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              {u.name}
              <button
                type="button"
                onClick={() => toggle(u)}
                aria-label={`Убрать ${u.name}`}
                className="rounded-full hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpened(true)}
          placeholder="Найти участника…"
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 pl-7 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {opened ? (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background">
          {pending && results === null ? (
            <div className="p-2 text-xs text-muted-foreground">Загрузка…</div>
          ) : results && results.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground">Никого не найдено</div>
          ) : (
            (results ?? []).map((u) => {
              const checked = picked.some((p) => p.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => undefined}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  <Avatar src={u.image} alt={u.name} className="size-6" />
                  <span className="flex-1 truncate">{u.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {u.email}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
