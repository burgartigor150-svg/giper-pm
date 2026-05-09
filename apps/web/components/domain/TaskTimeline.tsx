'use client';

import { useMemo, useState } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Globe, Lock, MessageSquare, History } from 'lucide-react';
import type { TaskStatus } from '@giper/db';
import { useT } from '@/lib/useT';
import { CommentForm } from './CommentForm';
import { renderRichText } from '@/lib/text/renderRichText';

type Author = { id: string; name: string; image: string | null };
type CommentItem = {
  kind: 'comment';
  at: Date;
  id: string;
  author: Author;
  body: string;
  visibility: 'EXTERNAL' | 'INTERNAL';
  /**
   * `true` for Bitrix-mirrored history events (deadline pushes,
   * watcher edits, status flips, …) — always rendered as system
   * lines and routed to a separate tab so real discussion isn't
   * buried under deadline noise.
   */
  isHistory: boolean;
};
type StatusItem = {
  kind: 'status';
  at: Date;
  id: string;
  actor: Author | null;
  from: TaskStatus | null;
  to: TaskStatus;
};
export type TLItem = CommentItem | StatusItem;

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** Single full timeline. We split per tab on the client. */
  items: TLItem[];
  /** Bitrix-mirror? Drives which tabs are shown and the form's visibility toggle. */
  isMirror: boolean;
  /** Map of userId → name/image used by renderMentions for inline pills. */
  mentions: Map<string, Author>;
};

type Tab = 'discussion' | 'events' | 'internal';

const PAGE_SIZE = 50;

/**
 * Tabbed timeline:
 *
 *   Mirror tasks (3 tabs):
 *     • Обсуждение  — real human comments from Bitrix (EXTERNAL,
 *                     non-history) + local status changes for context.
 *                     Default — that's where the conversation happens.
 *     • События     — Bitrix-mirrored history (deadline/watcher/etc).
 *     • Внутренний  — local-only INTERNAL comments + status events.
 *
 *   Local tasks (1 tab):
 *     • Чат         — internal comments + status changes.
 *
 * Newest entries float to the bottom (chronological feed). The list is
 * lazily rendered: we show the latest PAGE_SIZE rows by default with a
 * "Показать ещё" button to load older pages on click — keeps tasks
 * with thousands of history events fast to open.
 */
export function TaskTimeline({
  taskId,
  projectKey,
  taskNumber,
  items,
  isMirror,
  mentions,
}: Props) {
  const t = useT('tasks.detail');
  const tStatus = useT('tasks.status');
  const [tab, setTab] = useState<Tab>(isMirror ? 'discussion' : 'internal');
  const [shown, setShown] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (it.kind === 'status') {
        // Status events are useful context — show in Discussion and
        // Internal, hide from Events (which is Bitrix history-only).
        return tab !== 'events';
      }
      if (tab === 'events') return it.isHistory;
      if (tab === 'discussion')
        return !it.isHistory && it.visibility === 'EXTERNAL';
      // internal
      return !it.isHistory && it.visibility === 'INTERNAL';
    });
  }, [items, tab]);

  // Lazy paging: render only the LATEST `shown` items. Older rows live
  // behind a "Показать ещё" button so a 70-event task isn't 70 React
  // nodes on every render.
  const visible = useMemo(() => {
    if (filtered.length <= shown) return filtered;
    return filtered.slice(filtered.length - shown);
  }, [filtered, shown]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setShown(PAGE_SIZE);
  };

  return (
    <div className="flex flex-col gap-3">
      {isMirror ? (
        <div className="flex flex-wrap gap-1 rounded-md border border-input bg-background p-0.5 self-start">
          <TabBtn
            active={tab === 'discussion'}
            onClick={() => switchTab('discussion')}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Обсуждение
            <Badge>{items.filter((it) => it.kind === 'comment' && !it.isHistory && it.visibility === 'EXTERNAL').length}</Badge>
          </TabBtn>
          <TabBtn active={tab === 'events'} onClick={() => switchTab('events')}>
            <History className="h-3.5 w-3.5" />
            События
            <Badge>{items.filter((it) => it.kind === 'comment' && it.isHistory).length}</Badge>
          </TabBtn>
          <TabBtn
            active={tab === 'internal'}
            onClick={() => switchTab('internal')}
          >
            <Lock className="h-3.5 w-3.5" />
            Внутренний
            <Badge>{items.filter((it) => it.kind === 'comment' && !it.isHistory && it.visibility === 'INTERNAL').length}</Badge>
          </TabBtn>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel(tab, isMirror)}</p>
      ) : (
        <>
          {filtered.length > visible.length ? (
            <button
              type="button"
              onClick={() => setShown((s) => s + PAGE_SIZE)}
              className="self-start rounded border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Показать ещё ({filtered.length - visible.length} старше)
            </button>
          ) : null}

          <ul className="flex flex-col gap-3">
            {visible.map((item) =>
              item.kind === 'status' ? (
                <StatusRow
                  key={`s-${item.id}`}
                  item={item}
                  fromLabel={item.from ? tStatus(item.from) : null}
                  toLabel={tStatus(item.to)}
                />
              ) : item.isHistory ? (
                <HistoryRow key={`h-${item.id}`} item={item} mentions={mentions} />
              ) : (
                <CommentRow key={`c-${item.id}`} item={item} mentions={mentions} />
              ),
            )}
          </ul>
        </>
      )}

      <CommentForm
        taskId={taskId}
        projectKey={projectKey}
        taskNumber={taskNumber}
        // Form visibility toggle behaves the same as before:
        //   - mirror task: toggle visible, default = current tab maps
        //     onto the matching channel (discussion → EXTERNAL→Bitrix,
        //     internal → INTERNAL→stays local). Events tab ⇒ EXTERNAL
        //     (you'd usually be commenting on what just changed).
        //   - local task: hidden, INTERNAL by default.
        showVisibilityToggle={isMirror}
        defaultVisibility={tab === 'internal' ? 'INTERNAL' : 'EXTERNAL'}
      />
    </div>
  );
}

function emptyLabel(tab: Tab, isMirror: boolean): string {
  if (!isMirror) return 'Сообщений пока нет.';
  if (tab === 'discussion') return 'В обсуждении из Bitrix24 пока пусто.';
  if (tab === 'events') return 'Системных событий ещё не было.';
  return 'Внутренних сообщений пока нет.';
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs ' +
        (active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-accent')
      }
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-black/10 px-1 text-[10px] leading-4 text-current">
      {children}
    </span>
  );
}

function CommentRow({
  item,
  mentions,
}: {
  item: CommentItem;
  mentions: Map<string, Author>;
}) {
  return (
    <li
      className={
        'flex gap-3 ' +
        (item.visibility === 'INTERNAL'
          ? 'rounded-md border border-amber-200 bg-amber-50/50 p-2 -mx-2'
          : '')
      }
    >
      <Avatar src={item.author.image} alt={item.author.name} className="h-7 w-7" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{item.author.name}</span>
          <span>{item.at.toLocaleString('ru-RU')}</span>
          {item.visibility === 'INTERNAL' ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              Внутренний
            </span>
          ) : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">
          {renderMentions(item.body, mentions)}
        </p>
      </div>
    </li>
  );
}

function HistoryRow({
  item,
  mentions,
}: {
  item: CommentItem;
  mentions: Map<string, Author>;
}) {
  return (
    <li className="flex gap-3 text-xs text-muted-foreground">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/60">
        <History className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground">{item.author.name}</span>
          <span>{item.at.toLocaleString('ru-RU')}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words">
          {renderMentions(item.body, mentions)}
        </p>
      </div>
    </li>
  );
}

function StatusRow({
  item,
  fromLabel,
  toLabel,
}: {
  item: StatusItem;
  fromLabel: string | null;
  toLabel: string;
}) {
  return (
    <li className="flex gap-3 text-xs text-muted-foreground">
      <span className="mt-0.5 inline-block h-7 w-7 shrink-0 rounded-full bg-muted text-center leading-7">
        ↺
      </span>
      <div className="flex flex-1 flex-col">
        <span>
          <span className="font-medium text-foreground">
            {item.actor?.name ?? '—'}
          </span>{' '}
          {fromLabel
            ? `изменил(а) статус: ${fromLabel} → ${toLabel}`
            : `установил(а) статус: ${toLabel}`}
        </span>
        <span>{item.at.toLocaleString('ru-RU')}</span>
      </div>
    </li>
  );
}

function renderMentions(body: string, users: Map<string, Author>): React.ReactNode {
  const re = /@([a-z0-9]{24,})\b/g;
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(body)) !== null) {
    const id = match[1] ?? '';
    const u = users.get(id);
    if (!u) continue;
    if (match.index > lastIndex) {
      out.push(
        <span key={key++}>{renderRichText(body.slice(lastIndex, match.index))}</span>,
      );
    }
    out.push(
      <a
        key={key++}
        href={`/messages/dm/${u.id}`}
        className="rounded bg-blue-100 px-1 py-0.5 text-blue-800 hover:bg-blue-200"
      >
        @{u.name}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    out.push(<span key={key++}>{renderRichText(body.slice(lastIndex))}</span>);
  }
  return out.length === 0 ? renderRichText(body) : out;
}
