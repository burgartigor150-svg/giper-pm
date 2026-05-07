'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Send, Hash, Lock, MessageSquare, Plus } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { cn } from '@giper/ui/cn';
import {
  postMessageAction,
  markChannelReadAction,
  createChannelAction,
} from '@/actions/messenger';
import { renderRichText } from '@/lib/text/renderRichText';

type ChannelKind = 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM';

type ChannelLite = {
  id: string;
  kind: ChannelKind;
  slug: string;
  name: string;
  projectId: string | null;
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
};

type Props = {
  memberChannels: Array<ChannelLite & { _count?: { messages: number } }>;
  publicChannels: ChannelLite[];
  activeChannelId: string | null;
  initialMessages?: MessageRow[];
  meId?: string;
};

export function MessagesShell({
  memberChannels,
  publicChannels,
  activeChannelId,
  initialMessages = [],
  meId,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const memberDms = memberChannels.filter((c) => c.kind === 'DM' || c.kind === 'GROUP_DM');
  const memberRooms = memberChannels.filter((c) => c.kind === 'PUBLIC' || c.kind === 'PRIVATE');
  const joinable = publicChannels.filter(
    (c) => !memberChannels.some((mc) => mc.id === c.id),
  );

  function handleSend() {
    if (!activeChannelId || !draft.trim()) return;
    const body = draft.trim();
    setDraft('');
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
    startTransition(async () => {
      const res = await postMessageAction({ channelId: activeChannelId, body });
      if (!res.ok) {
        // Revert the optimistic append, keep draft so user can retry.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(body);
      } else {
        // Pull the real list once after a successful post — replaces
        // the temp row with the server-id one.
        router.refresh();
      }
    });
  }

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100vh-3.5rem)] grid-cols-[260px_minmax(0,1fr)] md:-mx-8">
      {/* Left rail: channels & DMs */}
      <aside className="flex h-full flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Чаты</h2>
          <CreateChannelButton />
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
            <div className="flex-1 overflow-y-auto px-4 py-4" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Здесь пока тихо. Будь первым.
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {messages.map((m) => (
                    <MessageRow key={m.id} m={m} />
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border bg-background p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter to send, Shift+Enter for newline.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Написать сообщение… (Enter — отправить, Shift+Enter — новая строка)"
                  rows={1}
                  className="min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={pending}
                />
                <Button type="submit" disabled={pending || !draft.trim()} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </>
        )}
      </section>
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

function MessageRow({ m }: { m: MessageRow }) {
  return (
    <li className="flex gap-3">
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
            <span className="text-[10px] text-muted-foreground">(изм.)</span>
          ) : null}
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
          {renderRichText(m.body)}
        </div>
        {m.replyCount > 0 ? (
          <div className="mt-1 text-xs text-blue-600">{m.replyCount} ответов в треде</div>
        ) : null}
      </div>
    </li>
  );
}

function CreateChannelButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreate() {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await createChannelAction({ name, kind });
      if (res.ok && res.data) {
        setOpen(false);
        setName('');
        router.push(`/messages/${res.data.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Создать канал"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-3 shadow-md">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Новый канал
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название…"
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            autoFocus
          />
          <div className="mb-2 flex gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'PUBLIC'}
                onChange={() => setKind('PUBLIC')}
              />
              Публичный
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'PRIVATE'}
                onChange={() => setKind('PRIVATE')}
              />
              Приватный
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              type="button"
              onClick={handleCreate}
              disabled={pending || !name.trim()}
            >
              Создать
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
