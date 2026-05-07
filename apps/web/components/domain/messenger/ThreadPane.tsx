'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { useRealtime } from '@giper/realtime/client';
import { channelForChat } from '@giper/realtime';
import { loadThreadAction, postMessageAction } from '@/actions/messenger';
import { renderRichText } from '@/lib/text/renderRichText';
import { MessageReactions } from './MessageReactions';
import { MessageComposer } from './MessageComposer';

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
  rootMessageId: string;
  meId: string;
  onClose: () => void;
};

/**
 * Thread sidebar. Loads root + replies via loadThreadAction, subscribes
 * to the parent channel's WS topic, refetches on any chat event for it.
 * Composer posts with parentId so the reply is appended to the thread.
 */
export function ThreadPane({ rootMessageId, meId, onClose }: Props) {
  const [data, setData] = useState<{
    root: MessageRow;
    replies: MessageRow[];
    channelId: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function reload() {
    const res = await loadThreadAction(rootMessageId);
    if (res) {
      setData({
        root: res.root as MessageRow,
        replies: res.replies as MessageRow[],
        channelId: res.channelId,
      });
    } else {
      setData(null);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMessageId]);

  // Live updates: any chat event in the parent channel triggers a refetch.
  useRealtime(data ? channelForChat(data.channelId) : null, () => {
    void reload();
  });

  // Auto-scroll to the bottom on new replies.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.replies.length]);

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">Тред</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть тред"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {!data ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : (
          <ul className="flex flex-col gap-3">
            <ThreadRow m={data.root} meId={meId} isRoot />
            {data.replies.length > 0 ? (
              <li className="my-1 border-t border-border" aria-hidden />
            ) : null}
            {data.replies.map((m) => (
              <ThreadRow key={m.id} m={m} meId={meId} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        <MessageComposer
          placeholder="Ответить в треде… (@ — упомянуть)"
          disabled={!data}
          onSend={async (body) => {
            if (!data) return;
            const res = await postMessageAction({
              channelId: data.channelId,
              body,
              parentId: rootMessageId,
            });
            if (!res.ok) throw new Error(res.error.message);
          }}
        />
      </div>
    </aside>
  );
}

function ThreadRow({ m, meId, isRoot }: { m: MessageRow; meId: string; isRoot?: boolean }) {
  return (
    <li className="group flex gap-3">
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
          {isRoot ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Исходное
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
          {renderRichText(m.body)}
        </div>
        <MessageReactions messageId={m.id} reactions={m.reactions} meId={meId} />
      </div>
    </li>
  );
}
