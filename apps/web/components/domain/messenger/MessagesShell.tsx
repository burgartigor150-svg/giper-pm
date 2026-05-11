'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Hash, Lock, MessageSquare } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { cn } from '@giper/ui/cn';
import { useRealtime } from '@giper/realtime/client';
import { channelForChat } from '@giper/realtime';
import {
  postMessageAction,
  markChannelReadAction,
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
import { VideoNotePlayer } from './VideoNotePlayer';
import { SystemEventCard, type SystemEvent } from './SystemEventCard';
import { MessageSquareReply } from 'lucide-react';

type ChannelKind = 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM';

type ChannelLite = {
  id: string;
  kind: ChannelKind;
  slug: string;
  name: string;
  projectId: string | null;
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
  source?: 'WEB' | 'MOBILE' | 'API' | 'SYSTEM';
  eventKind?:
    | 'CALL_STARTED'
    | 'CALL_ENDED'
    | 'MEMBER_CHANGED'
    | 'CHANNEL_RENAMED'
    | null;
  eventPayload?: unknown;
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
};

export function MessagesShell({
  memberChannels,
  publicChannels,
  activeChannelId,
  initialMessages = [],
  mentionedUsers = [],
  taskPreviews = [],
  meId,
}: Props) {
  const mentionsMap = new Map(mentionedUsers.map((u) => [u.id, u]));
  const previewsMap = new Map(taskPreviews.map((p) => [p.key, p]));
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close thread when navigating channels.
  useEffect(() => {
    setOpenThreadId(null);
  }, [activeChannelId]);

  // Reset when navigating between channels.
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Auto-scroll to bottom on first load and on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeChannelId, messages.length]);

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
  useRealtime(activeChannelId ? channelForChat(activeChannelId) : null, () => {
    router.refresh();
  });

  const memberDms = memberChannels.filter((c) => c.kind === 'DM' || c.kind === 'GROUP_DM');
  const memberRooms = memberChannels.filter((c) => c.kind === 'PUBLIC' || c.kind === 'PRIVATE');
  const joinable = publicChannels.filter(
    (c) => !memberChannels.some((mc) => mc.id === c.id),
  );

  return (
    <div
      className={cn(
        '-mx-4 -my-6 grid h-[calc(100vh-3.5rem)] md:-mx-8',
        openThreadId
          ? 'grid-cols-[260px_minmax(0,1fr)_360px]'
          : 'grid-cols-[260px_minmax(0,1fr)]',
      )}
    >
      {/* Left rail: channels & DMs */}
      <aside className="flex h-full flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Чаты</h2>
          <CreateChannelDialog />
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

      {/* Right pane: messages */}
      <section className="flex h-full min-w-0 flex-col">
        {!activeChannelId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Выбери канал или начни разговор слева
          </div>
        ) : (
          <>
            {(() => {
              // Resolve the active channel's metadata for the header.
              // The shell already has both member + public lists in
              // props — no need for a server fetch just to show name.
              const active =
                memberChannels.find((c) => c.id === activeChannelId) ??
                publicChannels.find((c) => c.id === activeChannelId);
              if (!active) return null;
              return (
                <ChannelHeader channel={active} />
              );
            })()}
            <div className="flex-1 overflow-y-auto px-4 py-4" ref={scrollRef}>
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
                      onOpenThread={() => setOpenThreadId(m.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border bg-background p-3">
              <MessageComposer
                placeholder="Написать сообщение… (@ — упомянуть пользователя, Enter — отправить)"
                channelId={activeChannelId ?? undefined}
                onVideoNoteSent={() => router.refresh()}
                onSend={async (body) => {
                  if (!activeChannelId) return;
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
                  const res = await postMessageAction({
                    channelId: activeChannelId,
                    body,
                  });
                  if (!res.ok) {
                    setMessages((prev) => prev.filter((m) => m.id !== tempId));
                    throw new Error(res.error.message);
                  }
                  router.refresh();
                }}
              />
            </div>
          </>
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
      </Link>
    </li>
  );
}

function MessageRow({
  m,
  meId,
  mentionsMap,
  previewsMap,
  onOpenThread,
}: {
  m: MessageRow;
  meId: string;
  mentionsMap: Map<string, { id: string; name: string }>;
  previewsMap: Map<string, TaskPreview>;
  onOpenThread: () => void;
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
    <li className="group relative flex gap-3">
      <Avatar src={m.author.image} alt={m.author.name} className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium">{m.author.name}</span>
          <span className="text-muted-foreground">
            {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {m.editedAt ? (
            <span className="text-xs text-muted-foreground">(изм.)</span>
          ) : null}
        </div>
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
              // FILE / AUDIO_NOTE / IMAGE → generic download link
              // for now. Specialised renderers can land later.
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
