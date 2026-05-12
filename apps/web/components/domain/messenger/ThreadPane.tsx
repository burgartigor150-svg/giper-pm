'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { useRealtime } from '@giper/realtime/client';
import { channelForChat } from '@giper/realtime';
import { loadThreadAction, postMessageAction } from '@/actions/messenger';
import { renderRichText } from '@/lib/text/renderRichText';
import { extractTaskRefs } from '@/lib/text/taskRefs';
import type { TaskPreview } from '@/lib/tasks/loadTaskPreviews';
import { MessageReactions } from './MessageReactions';
import { MessageComposer } from './MessageComposer';
import { TaskPreviewCard } from './TaskPreviewCard';
import { VideoNotePlayer } from './VideoNotePlayer';

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
    mentionedUsers: Array<{ id: string; name: string }>;
    taskPreviews: TaskPreview[];
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function reload() {
    const res = await loadThreadAction(rootMessageId);
    if (res) {
      setData({
        root: res.root as MessageRow,
        replies: res.replies as MessageRow[],
        channelId: res.channelId,
        mentionedUsers: res.mentionedUsers,
        taskPreviews: res.taskPreviews ?? [],
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
    <aside className="fixed inset-0 z-40 flex h-full w-full shrink-0 flex-col border-l border-border bg-background md:static md:w-[360px]">
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
            <ThreadRow
              m={data.root}
              meId={meId}
              mentionsMap={new Map(data.mentionedUsers.map((u) => [u.id, u]))}
              previewsMap={new Map((data.taskPreviews ?? []).map((p) => [p.key, p]))}
              isRoot
            />
            {data.replies.length > 0 ? (
              <li className="my-1 border-t border-border" aria-hidden />
            ) : null}
            {data.replies.map((m) => (
              <ThreadRow
                key={m.id}
                m={m}
                meId={meId}
                mentionsMap={new Map(data.mentionedUsers.map((u) => [u.id, u]))}
              previewsMap={new Map((data.taskPreviews ?? []).map((p) => [p.key, p]))}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        <MessageComposer
          placeholder="Ответить в треде… (@ — упомянуть)"
          disabled={!data}
          channelId={data?.channelId}
          parentId={rootMessageId}
          onVideoNoteSent={reload}
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

function ThreadRow({
  m,
  meId,
  mentionsMap,
  previewsMap,
  isRoot,
}: {
  m: MessageRow;
  meId: string;
  mentionsMap: Map<string, { id: string; name: string }>;
  previewsMap: Map<string, TaskPreview>;
  isRoot?: boolean;
}) {
  const refs = extractTaskRefs(m.body);
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
            <span className="text-xs text-muted-foreground">(изм.)</span>
          ) : null}
          {isRoot ? (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Исходное
            </span>
          ) : null}
        </div>
        {m.body ? (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
            {renderRichText(m.body, { mentions: mentionsMap })}
          </div>
        ) : null}
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
        <MessageReactions messageId={m.id} reactions={m.reactions} meId={meId} />
      </div>
    </li>
  );
}
