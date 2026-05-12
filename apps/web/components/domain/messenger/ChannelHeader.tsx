'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Hash,
  Lock,
  Users,
  X,
  Search,
  UserPlus,
  UserMinus,
  Phone,
  Bell,
  BellOff,
  Link as LinkIcon,
  Copy,
  Trash2,
  Megaphone,
  ChevronLeft,
} from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import {
  listChannelMembersAction,
  inviteToChannelAction,
  removeFromChannelAction,
  searchUsersForMention,
  setChannelMutedAction,
  createChannelInviteAction,
  listChannelInvitesAction,
  revokeChannelInviteAction,
  deleteChannelAction,
} from '@/actions/messenger';
import { startCallInChannelAction } from '@/actions/meetings';

type ChannelLite = {
  id: string;
  name: string;
  slug: string;
  kind: 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM' | 'BROADCAST';
};

type ChannelMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  isCreator: boolean;
};

/**
 * Top bar above the active channel's message list.
 *
 * - Shows channel name + kind icon (Hash for PUBLIC, Lock for
 *   PRIVATE; DM/GROUP_DM hidden because the channel name there is
 *   the other participant, which already appears in the sidebar).
 * - Right-side button opens a Members panel: list everyone with
 *   role + creator badge, lets the channel ADMIN invite or remove.
 * - The panel is a right-side sliding overlay (not a modal) so the
 *   user can keep glancing at the chat.
 */
export function ChannelHeader({
  channel,
  isMuted = false,
  canDelete = false,
}: {
  channel: ChannelLite;
  isMuted?: boolean;
  /** True when the viewer is the channel's creator. Surfaces the
   *  delete button — the server action also re-checks. */
  canDelete?: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [callPending, startCall] = useTransition();
  const [mutePending, startMute] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const router = useRouter();
  // DM/GROUP_DM no longer hide the header — we want the call button
  // there too. We keep the title visible for context (the sidebar
  // also shows it, but redundancy is cheap and avoids whiplash).
  const Icon =
    channel.kind === 'PRIVATE'
      ? Lock
      : channel.kind === 'BROADCAST'
        ? Megaphone
        : channel.kind === 'DM' || channel.kind === 'GROUP_DM'
          ? Users
          : Hash;
  const isDm = channel.kind === 'DM' || channel.kind === 'GROUP_DM';

  function call() {
    startCall(async () => {
      const r = await startCallInChannelAction({ channelId: channel.id });
      if (!r.ok) {
        // Inline alert is harsh but we don't have toast yet. The
        // most common reason is "Нет прав" which the user can read
        // and react to.
        // eslint-disable-next-line no-alert
        alert(r.message);
        return;
      }
      router.push(`/meetings/${r.meetingId}`);
    });
  }

  function toggleMute() {
    startMute(async () => {
      const r = await setChannelMutedAction(channel.id, !isMuted);
      if (!r.ok) {
        // eslint-disable-next-line no-alert
        alert(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  function destroy() {
    // eslint-disable-next-line no-alert
    const sure = window.confirm(
      `Удалить канал «${channel.name}» вместе со всей историей? Это действие нельзя отменить.`,
    );
    if (!sure) return;
    startDelete(async () => {
      const r = await deleteChannelAction(channel.id);
      if (!r.ok) {
        // eslint-disable-next-line no-alert
        alert(r.error.message);
        return;
      }
      router.push('/messages');
      router.refresh();
    });
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* Mobile-only back-to-list link. The shell hides the list
              when a channel is active, so this is the only escape. */}
          <Link
            href="/messages"
            className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-label="К списку чатов"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold">{channel.name}</h2>
        </div>
        <div className="flex items-center gap-0.5 md:gap-1">
          <button
            type="button"
            onClick={call}
            disabled={callPending}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Начать звонок в этом чате"
            title="Позвонить"
          >
            <Phone className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {callPending ? 'Создаём…' : 'Позвонить'}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleMute}
            disabled={mutePending}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label={isMuted ? 'Включить уведомления' : 'Отключить уведомления'}
            title={isMuted ? 'Уведомления выключены' : 'Уведомления включены'}
          >
            {isMuted ? (
              <BellOff className="size-3.5" aria-hidden="true" />
            ) : (
              <Bell className="size-3.5" aria-hidden="true" />
            )}
          </button>
          {!isDm ? (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Участники канала"
              title="Участники"
            >
              <Users className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Участники</span>
            </button>
          ) : null}
          {canDelete && !isDm ? (
            <button
              type="button"
              onClick={destroy}
              disabled={deletePending}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              aria-label="Удалить канал"
              title="Удалить канал"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      {panelOpen ? (
        <MembersPanel
          channelId={channel.id}
          channelKind={channel.kind}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </>
  );
}

function MembersPanel({
  channelId,
  channelKind,
  onClose,
}: {
  channelId: string;
  channelKind: 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM' | 'BROADCAST';
  onClose: () => void;
}) {
  const [data, setData] = useState<{ members: ChannelMember[]; canManage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);

  function reload() {
    startTransition(async () => {
      const r = await listChannelMembersAction(channelId);
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else {
        setError(r.error.message);
      }
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Close on Esc — convenience for keyboard users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function remove(userId: string) {
    startTransition(async () => {
      const r = await removeFromChannelAction(channelId, userId);
      if (r.ok) {
        reload();
      } else {
        setError(r.error.message);
      }
    });
  }

  return (
    <>
      {/* Sliding right panel, not a modal — scrim is light so the
          chat behind stays readable. Click on scrim closes. */}
      <div
        className="fixed inset-0 z-40 bg-foreground/20"
        onClick={onClose}
        role="presentation"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Участники канала"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-sm font-semibold">Участники</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {pending && data === null ? (
            <p className="text-xs text-muted-foreground">Загрузка…</p>
          ) : data && data.members.length === 0 ? (
            <p className="text-xs text-muted-foreground">Пусто</p>
          ) : (
            <ul className="flex flex-col">
              {(data?.members ?? []).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Avatar src={m.image} alt={m.name} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      {m.role === 'ADMIN' ? (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          админ
                        </span>
                      ) : null}
                      {m.isCreator ? (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          создатель
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  {data?.canManage && !m.isCreator ? (
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      disabled={pending}
                      className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      aria-label={`Удалить ${m.name}`}
                      title="Удалить из канала"
                    >
                      <UserMinus className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        {data?.canManage ? (
          <div className="border-t border-border p-3 space-y-2">
            {!inviteOpen ? (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserPlus className="size-3.5" />
                Пригласить участников
              </button>
            ) : (
              <InviteForm
                channelId={channelId}
                existingIds={new Set((data?.members ?? []).map((m) => m.id))}
                onDone={() => {
                  setInviteOpen(false);
                  reload();
                }}
                onCancel={() => setInviteOpen(false)}
              />
            )}
            {channelKind === 'PRIVATE' ? (
              <InviteLinksSection channelId={channelId} />
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function InviteForm({
  channelId,
  existingIds,
  onDone,
  onCancel,
}: {
  channelId: string;
  existingIds: Set<string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    Array<{ id: string; name: string; email: string; image: string | null }> | null
  >(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        const r = await searchUsersForMention(query);
        setResults(r);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (picked.size === 0) {
      onCancel();
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await inviteToChannelAction(channelId, [...picked]);
      if (r.ok) {
        onDone();
      } else {
        setError(r.error.message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти участника…"
          autoFocus
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 pl-7 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {pending && results === null ? (
          <p className="p-2 text-xs text-muted-foreground">Загрузка…</p>
        ) : results && results.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Никого не найдено</p>
        ) : (
          (results ?? [])
            .filter((u) => !existingIds.has(u.id))
            .map((u) => {
              const checked = picked.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u.id)}
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
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                </button>
              );
            })
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || picked.size === 0}
          className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pending ? 'Добавляю…' : `Добавить (${picked.size})`}
        </button>
      </div>
    </div>
  );
}

type InviteRow = {
  id: string;
  token: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
};

function InviteLinksSection({ channelId }: { channelId: string }) {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  function reload() {
    startTransition(async () => {
      const r = await listChannelInvitesAction(channelId);
      if (r.ok) {
        setInvites(r.data);
        setError(null);
      } else {
        setError(r.error.message);
      }
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  function create() {
    setError(null);
    startTransition(async () => {
      const r = await createChannelInviteAction(channelId);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      reload();
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      const r = await revokeChannelInviteAction(id);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      reload();
    });
  }

  function inviteUrl(token: string): string {
    if (typeof window === 'undefined') return `/i/${token}`;
    return `${window.location.origin}/i/${token}`;
  }

  async function copy(token: string) {
    const url = inviteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      // Fallback: show the URL in an alert so the user can copy manually.
      // eslint-disable-next-line no-alert
      prompt('Скопируйте ссылку:', url);
    }
  }

  const active = (invites ?? []).filter((i) => !i.revokedAt);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Ссылки-приглашения
        </span>
        <button
          type="button"
          onClick={create}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <LinkIcon className="size-3" />
          Создать
        </button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Нет активных ссылок
        </p>
      ) : (
        <ul className="space-y-1">
          {active.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1.5"
            >
              <code className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {inviteUrl(inv.token)}
              </code>
              <button
                type="button"
                onClick={() => copy(inv.token)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Скопировать ссылку"
                title={copied === inv.token ? 'Скопировано' : 'Скопировать'}
              >
                <Copy className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => revoke(inv.id)}
                disabled={pending}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label="Отозвать"
                title="Отозвать"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
