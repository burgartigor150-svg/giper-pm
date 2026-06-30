'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Hash, Lock, MessageSquare, Megaphone, Search } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { cn } from '@giper/ui/cn';
import { useRealtime, useTypingPublisher } from '@giper/realtime/client';
import { channelForChat } from '@giper/realtime';
import {
  postMessageAction,
  markChannelReadAction,
  loadOlderMessagesAction,
} from '@/actions/messenger';
import { renderRichText } from '@/lib/text/renderRichText';
import { extractTaskRefs } from '@/lib/text/taskRefs';
import type { TaskPreview } from '@/lib/tasks/loadTaskPreviews';
import { MessageReactions } from './MessageReactions';
import { ThreadPane } from './ThreadPane';
import { MessageComposer } from './MessageComposer';
import { TaskPreviewCard } from './TaskPreviewCard';
import { CreateChannelDialog } from './CreateChannelDialog';
import { ChannelHeader } from './ChannelHeader';
import { PinnedBar } from './PinnedBar';
import { VideoNotePlayer } from './VideoNotePlayer';
import { AudioNotePlayer } from './AudioNotePlayer';
import { SystemEventCard, type SystemEvent } from './SystemEventCard';
import { MessageActions } from './MessageActions';
import { Pin, MessageSquareReply, CornerUpLeft, X, ArrowDown } from 'lucide-react';

/**
 * Smooth-scroll to a message by id + brief highlight. Used by reply-quote
 * clicks. If the target isn't in the loaded window it's a no-op (out-of-window
 * jump-to-message lands with pagination in a later slice).
 */
function scrollToMessage(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-primary', 'rounded-md');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'rounded-md'), 1500);
}

type ChannelKind = 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM' | 'BROADCAST';

type ChannelLite = {
  id: string;
  kind: ChannelKind;
  slug: string;
  name: string;
  projectId: string | null;
  /** Unread messages for the current user (sidebar badge). */
  unreadCount?: number;
};

type MessageAttachmentLite = {
  id: string;
  kind: 'FILE' | 'VIDEO_NOTE' | 'AUDIO_NOTE' | 'IMAGE';
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  filename: string;
};

type MessageRow = {
  id: string;
  body: string;
  authorId: string;
  author: { id: string; name: string; image: string | null };
  parentId: string | null;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
  reactions: Array<{ userId: string; emoji: string }>;
  attachments?: MessageAttachmentLite[];
  replyToId?: string | null;
  replyTo?: {
    id: string;
    body: string;
    deletedAt: Date | string | null;
    author: { name: string };
  } | null;
  source?: 'WEB' | 'MOBILE' | 'API' | 'SYSTEM';
  eventKind?:
    | 'CALL_STARTED'
    | 'CALL_ENDED'
    | 'MEMBER_CHANGED'
    | 'CHANNEL_RENAMED'
    | null;
  eventPayload?: unknown;
  pinnedAt?: Date | string | null;
};

type MentionUser = { id: string; name: string };

type Props = {
  memberChannels: Array<ChannelLite & { _count?: { messages: number } }>;
  publicChannels: ChannelLite[];
  activeChannelId: string | null;
  initialMessages?: MessageRow[];
  mentionedUsers?: MentionUser[];
  /**
   * Flat task previews resolved on the server for every task ref in
   * the visible messages. The renderer extracts refs from each body
   * on the fly and reads from this lookup; visibility is already
   * applied per-viewer upstream.
   */
  taskPreviews?: TaskPreview[];
  meId?: string;
  /** Caller's channel role — null when not a member. Used to gate
   *  pin/unpin actions (ADMIN only). */
  myChannelRole?: 'ADMIN' | 'MEMBER' | null;
  /** Whether the caller has muted the active channel. Drives the
   *  bell icon state in the header. */
  isMuted?: boolean;
  /** True when the caller created the active channel. Surfaces the
   *  delete button in the header. */
  canDeleteChannel?: boolean;
  /** Deep-link target (?msg=<id>) — scroll to + flash this message on load. */
  targetMessageId?: string | null;
  /** Current user's display name — used for the outgoing typing signal. */
  meName?: string | null;
};

export function MessagesShell({
  memberChannels,
  publicChannels,
  activeChannelId,
  initialMessages = [],
  mentionedUsers = [],
  taskPreviews = [],
  meId,
  myChannelRole = null,
  isMuted = false,
  canDeleteChannel = false,
  targetMessageId = null,
  meName = null,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  // Mention/task-preview lookups grow as older pages are prepended.
  const [extraMentions, setExtraMentions] = useState<MentionUser[]>([]);
  const [extraPreviews, setExtraPreviews] = useState<TaskPreview[]>([]);
  const mentionsMap = new Map([...mentionedUsers, ...extraMentions].map((u) => [u.id, u]));
  const previewsMap = new Map([...taskPreviews, ...extraPreviews].map((p) => [p.key, p]));
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string; body: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; exp: number }>>(new Map());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const prependHeightRef = useRef<number | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);

  // Close thread + clear reply draft when navigating channels.
  useEffect(() => {
    setOpenThreadId(null);
    setReplyTo(null);
  }, [activeChannelId]);

  // Reset paginated state when the server payload changes (channel switch OR a
  // router.refresh() that brought new messages — realtime still drives that
  // until the in-place-patch slice lands). Keep a bottom-anchored reader pinned
  // to the bottom; don't yank a reader who has scrolled up into history.
  useEffect(() => {
    const wasNearBottom = nearBottomRef.current;
    setMessages(initialMessages);
    setExtraMentions([]);
    setExtraPreviews([]);
    setHasMore(true);
    lastMsgIdRef.current = initialMessages[initialMessages.length - 1]?.id ?? null;
    if (wasNearBottom) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [initialMessages]);

  // Always land at the bottom when opening a different channel.
  useEffect(() => {
    nearBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeChannelId]);

  // New message at the bottom (append): auto-scroll only when the user is
  // already near the bottom — don't yank them down while reading history.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastId;
      if (nearBottomRef.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages]);

  // Preserve scroll position when an OLDER page is prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prependHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    }
  }, [messages]);

  // Deep link (?msg=<id>): jump to + flash the target after the list paints.
  useEffect(() => {
    if (!targetMessageId) return;
    const t = window.setTimeout(() => scrollToMessage(targetMessageId), 80);
    return () => window.clearTimeout(t);
  }, [targetMessageId, activeChannelId]);

  async function loadOlder() {
    if (loadingOlderRef.current || !hasMore || messages.length === 0 || !activeChannelId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = scrollRef.current;
    prependHeightRef.current = el ? el.scrollHeight : null;
    try {
      const res = await loadOlderMessagesAction({
        channelId: activeChannelId,
        before: new Date(messages[0]!.createdAt).toISOString(),
        limit: 50,
      });
      if (res && res.messages.length > 0) {
        setExtraMentions((prev) => [...prev, ...res.mentionedUsers]);
        setExtraPreviews((prev) => [...prev, ...res.taskPreviews]);
        setMessages((prev) => [...(res.messages as MessageRow[]), ...prev]);
        setHasMore(res.hasMore);
      } else {
        setHasMore(false);
        prependHeightRef.current = null;
      }
    } catch {
      prependHeightRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distFromBottom < 120;
    setShowJumpBtn(distFromBottom > 300);
    if (el.scrollTop < 80) void loadOlder();
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Mark channel as read on open.
  useEffect(() => {
    if (activeChannelId) {
      void markChannelReadAction(activeChannelId);
    }
  }, [activeChannelId]);

  // Live updates from other users: refresh on any chat event for the
  // current channel. Cheap and correct (router.refresh re-fetches the
  // RSC tree via Next's server-render); we'll switch to in-place
  // patches once a virtualized message list is in.
  useRealtime(activeChannelId ? channelForChat(activeChannelId) : null, (payload) => {
    const p = payload as {
      __typing?: boolean;
      userId?: string;
      name?: string;
      type?: string;
      userIds?: string[];
    };
    if (p && p.type === 'presence:state' && Array.isArray(p.userIds)) {
      // Who's currently in this channel (online dot). Exclude self.
      setOnlineIds(new Set(p.userIds.filter((id) => id !== meId)));
      return;
    }
    if (p && p.__typing) {
      // Ephemeral typing signal — show "<name> печатает…", don't refetch.
      if (p.userId && p.userId !== meId) {
        const uid = p.userId;
        const name = p.name || 'Кто-то';
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(uid, { name, exp: Date.now() + 5000 });
          return next;
        });
      }
      return;
    }
    router.refresh();
  });

  // Expire stale typing entries every second.
  useEffect(() => {
    const i = window.setInterval(() => {
      setTypingUsers((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (v.exp <= now) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(i);
  }, []);
  // Clear typing + presence when switching channels.
  useEffect(() => {
    setTypingUsers(new Map());
    setOnlineIds(new Set());
  }, [activeChannelId]);

  const typingPublish = useTypingPublisher(
    activeChannelId ? channelForChat(activeChannelId) : null,
  );
  const typingLabel = (() => {
    const names = [...typingUsers.values()].map((v) => v.name);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} печатает…`;
    if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
    return `${names.length} человек печатают…`;
  })();

  const memberDms = memberChannels.filter((c) => c.kind === 'DM' || c.kind === 'GROUP_DM');
  const memberRooms = memberChannels.filter(
    (c) => c.kind === 'PUBLIC' || c.kind === 'PRIVATE' || c.kind === 'BROADCAST',
  );
  const joinable = publicChannels.filter(
    (c) => !memberChannels.some((mc) => mc.id === c.id),
  );

  // Mobile layout switch: when a channel is selected the list slides
  // out (hidden); when no channel is selected the list is full-width.
  // Desktop keeps both panes side-by-side as before. The thread pane
  // is hidden on mobile entirely — too cramped to be useful.
  return (
    <div
      className={cn(
        '-mx-4 -my-6 grid h-[calc(100vh-3.5rem)] md:-mx-8',
        // Mobile: single column. Desktop: 2 (or 3 with thread) columns.
        'grid-cols-1',
        openThreadId
          ? 'md:grid-cols-[260px_minmax(0,1fr)_360px]'
          : 'md:grid-cols-[260px_minmax(0,1fr)]',
      )}
    >
      {/* Left rail: channels & DMs. Hidden on mobile when a channel is
          active — chat pane gets the whole screen. */}
      <aside
        className={cn(
          'flex h-full flex-col border-r border-border bg-background',
          activeChannelId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Чаты</h2>
          <div className="flex items-center gap-1">
            <Link
              href="/messages/search"
              aria-label="Поиск по сообщениям"
              title="Поиск по сообщениям"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="size-4" />
            </Link>
            <CreateChannelDialog />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-sm">
          <Section title="Каналы">
            {memberRooms.map((c) => (
              <ChannelLink
                key={c.id}
                channel={c}
                active={activeChannelId === c.id}
              />
            ))}
            {memberRooms.length === 0 ? (
              <EmptyHint>Нет каналов</EmptyHint>
            ) : null}
          </Section>

          <Section title="Сообщения">
            {memberDms.map((c) => (
              <ChannelLink
                key={c.id}
                channel={c}
                active={activeChannelId === c.id}
              />
            ))}
            {memberDms.length === 0 ? (
              <EmptyHint>Нет личных сообщений</EmptyHint>
            ) : null}
          </Section>

          {joinable.length > 0 ? (
            <Section title="Можно вступить">
              {joinable.map((c) => (
                <ChannelLink
                  key={c.id}
                  channel={c}
                  active={false}
                  faded
                />
              ))}
            </Section>
          ) : null}
        </div>
      </aside>

      {/* Right pane: messages. On mobile this is the whole screen
          when a channel is active; otherwise hidden so the list takes
          over. */}
      <section
        className={cn(
          'flex h-full min-w-0 flex-col',
          !activeChannelId ? 'hidden md:flex' : 'flex',
        )}
      >
        {!activeChannelId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Выбери канал или начни разговор слева
          </div>
        ) : (
          (() => {
            // Resolve the active channel's metadata for the header +
            // composer permissions. The shell already has both
            // member + public lists in props — no need for a server
            // fetch just to show name.
            const active =
              memberChannels.find((c) => c.id === activeChannelId) ??
              publicChannels.find((c) => c.id === activeChannelId);
            // BROADCAST channels: only admins (the channel's
            // co-authors) get the composer. Everyone else reads.
            const canPost =
              active?.kind === 'BROADCAST'
                ? myChannelRole === 'ADMIN'
                : true;
            return (
              <>
                {active ? (
                  <ChannelHeader
                    channel={active}
                    isMuted={isMuted}
                    canDelete={canDeleteChannel}
                    isMember={myChannelRole !== null}
                  />
                ) : null}
                {activeChannelId ? (
                  <PinnedBar channelId={activeChannelId} onJump={scrollToMessage} />
                ) : null}
                {onlineIds.size > 0 ? (
                  <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground">
                    <span className="inline-block size-2 rounded-full bg-green-500" aria-hidden="true" />
                    {active?.kind === 'DM'
                      ? 'в сети'
                      : `${onlineIds.size} ${onlineIds.size === 1 ? 'в сети' : 'в сети'}`}
                  </div>
                ) : null}
            <div className="relative min-h-0 flex-1">
              <div className="h-full overflow-y-auto px-4 py-4" ref={scrollRef} onScroll={onScroll}>
                {loadingOlder ? (
                  <div className="pb-2 text-center text-xs text-muted-foreground">
                    Загрузка истории…
                  </div>
                ) : null}
                {messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Здесь пока тихо. Будь первым.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {messages.map((m) => (
                      <MessageRow
                        key={m.id}
                        m={m}
                        meId={meId ?? ''}
                        mentionsMap={mentionsMap}
                        previewsMap={previewsMap}
                        canPin={myChannelRole === 'ADMIN'}
                        onChanged={() => router.refresh()}
                        onOpenThread={() => setOpenThreadId(m.id)}
                        onReply={() =>
                          setReplyTo({ id: m.id, authorName: m.author.name, body: m.body })
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
              {showJumpBtn ? (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  aria-label="К последним сообщениям"
                  title="К последним сообщениям"
                  className="absolute bottom-3 right-4 z-10 flex size-9 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowDown className="size-4" />
                </button>
              ) : null}
            </div>
            {typingLabel ? (
              <div className="px-4 pb-1 text-xs italic text-muted-foreground" aria-live="polite">
                {typingLabel}
              </div>
            ) : null}
            {canPost ? (
              <div className="border-t border-border bg-background p-3">
                {replyTo ? (
                  <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary/60 bg-muted/40 px-2 py-1 text-xs">
                    <CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground">В ответ </span>
                      <span className="font-medium">{replyTo.authorName}</span>
                      {replyTo.body ? <span className="text-muted-foreground">: {replyTo.body}</span> : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      aria-label="Отменить ответ"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}
                <MessageComposer
                  placeholder="Написать сообщение… (@ — упомянуть пользователя, Enter — отправить)"
                  channelId={activeChannelId ?? undefined}
                  onVideoNoteSent={() => router.refresh()}
                  onTyping={() => typingPublish(meName || 'Кто-то')}
                  onSend={async (body) => {
                    if (!activeChannelId) return;
                    const replyToId = replyTo?.id ?? null;
                    // Optimistic append.
                    const tempId = `temp-${Date.now()}`;
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: tempId,
                        body,
                        authorId: meId ?? '',
                        author: { id: meId ?? '', name: 'Вы', image: null },
                        parentId: null,
                        replyCount: 0,
                        editedAt: null,
                        createdAt: new Date(),
                        reactions: [],
                      },
                    ]);
                    setReplyTo(null);
                    const res = await postMessageAction({
                      channelId: activeChannelId,
                      body,
                      replyToId,
                    });
                    if (!res.ok) {
                      setMessages((prev) => prev.filter((m) => m.id !== tempId));
                      throw new Error(res.error.message);
                    }
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <div className="border-t border-border bg-background p-3 text-center text-xs text-muted-foreground">
                В этот канал можно только читать
              </div>
            )}
              </>
            );
          })()
        )}
      </section>

      {openThreadId ? (
        <ThreadPane
          rootMessageId={openThreadId}
          meId={meId ?? ''}
          onClose={() => setOpenThreadId(null)}
        />
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1 text-xs italic text-muted-foreground">{children}</li>;
}

function ChannelLink({
  channel,
  active,
  faded,
}: {
  channel: ChannelLite;
  active: boolean;
  faded?: boolean;
}) {
  const Icon =
    channel.kind === 'PRIVATE'
      ? Lock
      : channel.kind === 'BROADCAST'
        ? Megaphone
        : channel.kind === 'DM' || channel.kind === 'GROUP_DM'
          ? MessageSquare
          : Hash;
  return (
    <li>
      <Link
        href={`/messages/${channel.id}`}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : faded
              ? 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              : 'hover:bg-accent',
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{channel.name}</span>
        {channel.unreadCount && channel.unreadCount > 0 ? (
          <span
            className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-none text-primary-foreground"
            aria-label={`${channel.unreadCount} непрочитанных`}
          >
            {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function MessageRow({
  m,
  meId,
  mentionsMap,
  previewsMap,
  canPin,
  onChanged,
  onOpenThread,
  onReply,
}: {
  m: MessageRow;
  meId: string;
  mentionsMap: Map<string, { id: string; name: string }>;
  previewsMap: Map<string, TaskPreview>;
  canPin: boolean;
  onChanged: () => void;
  onOpenThread: () => void;
  onReply?: () => void;
}) {
  // Resolve task refs in this message body. We do this per-row
  // (not pre-attached per message in the server payload) because
  // the same task can be referenced by many rows — flat lookup
  // avoids shipping duplicates.
  const refs = extractTaskRefs(m.body);

  // SYSTEM events get a specialised card without avatar / author /
  // timestamp chrome — that data is encoded inside the card itself.
  if (m.source === 'SYSTEM' && m.eventKind) {
    return (
      <li className="flex justify-center">
        <SystemEventCard
          kind={m.eventKind as SystemEvent}
          authorName={m.author.name}
          payload={m.eventPayload ?? null}
          createdAt={new Date(m.createdAt)}
        />
      </li>
    );
  }

  return (
    <li id={`msg-${m.id}`} className="group relative flex scroll-mt-4 gap-3">
      <Avatar src={m.author.image} alt={m.author.name} className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium">{m.author.name}</span>
          <span className="text-muted-foreground tabular-nums">
            {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {m.editedAt ? (
            <span className="text-xs text-muted-foreground">(изм.)</span>
          ) : null}
          {m.pinnedAt ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="Закреплено">
              <Pin className="size-3" aria-hidden="true" />
              закреплено
            </span>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-0.5">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                title="Ответить"
                aria-label="Ответить"
                className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                <CornerUpLeft className="size-3.5" />
              </button>
            ) : null}
            <MessageActions
              messageId={m.id}
              isAuthor={m.authorId === meId}
              canPin={canPin}
              pinned={!!m.pinnedAt}
              currentBody={m.body}
              onChanged={onChanged}
            />
          </span>
        </div>
        {m.replyToId ? (
          <button
            type="button"
            onClick={() => scrollToMessage(m.replyToId!)}
            className="mt-0.5 flex w-full max-w-md items-center gap-1.5 rounded border-l-2 border-primary/60 bg-muted/40 px-2 py-1 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CornerUpLeft className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">
              <span className="font-medium">{m.replyTo?.author.name ?? ''}</span>{' '}
              <span className="text-muted-foreground">
                {m.replyTo?.deletedAt
                  ? 'сообщение удалено'
                  : m.replyTo?.body || 'вложение'}
              </span>
            </span>
          </button>
        ) : null}
        {m.body ? (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
            {renderRichText(m.body, { mentions: mentionsMap })}
          </div>
        ) : null}
        {/* Attachments above task previews — video-notes are the
            primary content of their message, not an annotation. */}
        {m.attachments && m.attachments.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {m.attachments.map((a) => {
              if (a.kind === 'VIDEO_NOTE') {
                return (
                  <VideoNotePlayer
                    key={a.id}
                    attachmentId={a.id}
                    durationSec={a.durationSec}
                  />
                );
              }
              if (a.kind === 'AUDIO_NOTE') {
                return (
                  <AudioNotePlayer
                    key={a.id}
                    attachmentId={a.id}
                    durationSec={a.durationSec}
                  />
                );
              }
              if (a.kind === 'IMAGE') {
                // Inline thumbnail; click opens the full image in a new tab
                // (served via the hardened attachment proxy).
                return (
                  <a
                    key={a.id}
                    href={`/api/messages/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={a.filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/messages/attachments/${a.id}`}
                      alt={a.filename}
                      width={a.width ?? undefined}
                      height={a.height ?? undefined}
                      loading="lazy"
                      className="max-h-80 max-w-[20rem] object-cover"
                    />
                  </a>
                );
              }
              // FILE / AUDIO_NOTE → generic download chip.
              return (
                <a
                  key={a.id}
                  href={`/api/messages/attachments/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  📎 {a.filename}
                </a>
              );
            })}
          </div>
        ) : null}
        {refs.length > 0 ? (
          <div className="mt-1 flex flex-col gap-1">
            {refs.map((r) => {
              const key = `${r.key}-${r.number}`;
              const preview = previewsMap.get(key);
              if (!preview) return null;
              return <TaskPreviewCard key={key} preview={preview} />;
            })}
          </div>
        ) : null}
        <MessageReactions
          messageId={m.id}
          reactions={m.reactions}
          meId={meId}
        />
        {m.replyCount > 0 ? (
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-accent"
          >
            <MessageSquareReply className="h-3 w-3" />
            {m.replyCount} {pluralReplies(m.replyCount)}
          </button>
        ) : null}
      </div>
      {/* Hover affordance: appears on the right edge to start a thread. */}
      <button
        type="button"
        onClick={onOpenThread}
        className="absolute right-0 top-0 inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 opacity-0 shadow-md transition-opacity hover:bg-blue-50 group-hover:opacity-100"
        title="Ответить в треде"
      >
        <MessageSquareReply className="h-3.5 w-3.5" />
        Ответить
      </button>
    </li>
  );
}

function pluralReplies(n: number): string {
  // ru pluralisation: 1 — ответ, 2-4 — ответа, 5+ — ответов
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ответ';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ответа';
  return 'ответов';
}

// CreateChannelButton moved to CreateChannelDialog with member picker.
