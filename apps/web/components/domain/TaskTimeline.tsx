'use client';

import { useState } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Globe, Lock } from 'lucide-react';
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
  /** Single full timeline. We split by visibility on the client per tab. */
  items: TLItem[];
  /** Bitrix-mirror? Drives which tabs are shown and the form's visibility toggle. */
  isMirror: boolean;
  /** Map of userId → name/image used by renderMentions for inline pills. */
  mentions: Map<string, Author>;
};

/**
 * Two-tab timeline:
 *   - For mirror tasks: «Bitrix» (external comments + status events) is
 *     the default; «Внутренний» (internal comments + status events) is
 *     the second tab. Comments posted in the Bitrix tab push to Bitrix
 *     under the author's name; comments in Внутренний stay local.
 *   - For local tasks: a single «Чат» tab — there's no client-facing
 *     channel to split into.
 *
 * Status changes appear in both tabs because they're context, not
 * messages. Removing them from one tab would make it harder to read
 * the conversation in chronological order.
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
  const [tab, setTab] = useState<'external' | 'internal'>(
    isMirror ? 'external' : 'internal',
  );

  const filtered = items.filter((it) => {
    if (it.kind === 'status') return true; // status events are context, in both
    return tab === 'external'
      ? it.visibility === 'EXTERNAL'
      : it.visibility === 'INTERNAL';
  });

  return (
    <div className="flex flex-col gap-3">
      {isMirror ? (
        <div className="flex gap-1 rounded-md border border-input bg-background p-0.5 self-start">
          <TabBtn active={tab === 'external'} onClick={() => setTab('external')}>
            <Globe className="h-3.5 w-3.5" />
            Bitrix
          </TabBtn>
          <TabBtn active={tab === 'internal'} onClick={() => setTab('internal')}>
            <Lock className="h-3.5 w-3.5" />
            Внутренний
          </TabBtn>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === 'external'
            ? 'В чате с Bitrix24 пока пусто.'
            : 'Внутренних сообщений пока нет.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((item) =>
            item.kind === 'comment' ? (
              <CommentRow key={`c-${item.id}`} item={item} mentions={mentions} />
            ) : (
              <StatusRow
                key={`s-${item.id}`}
                item={item}
                fromLabel={item.from ? tStatus(item.from) : null}
                toLabel={tStatus(item.to)}
              />
            ),
          )}
        </ul>
      )}

      <CommentForm
        taskId={taskId}
        projectKey={projectKey}
        taskNumber={taskNumber}
        // The form decides visibility:
        //  - on a mirror task: shows the toggle (default = the
        //    currently-active tab's visibility), letting the author
        //    flip if they meant the other channel.
        //  - on a local task: hidden, always INTERNAL by default.
        showVisibilityToggle={isMirror}
        defaultVisibility={tab === 'external' ? 'EXTERNAL' : 'INTERNAL'}
      />
    </div>
  );
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
      <div className="flex-1">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{item.author.name}</span>
          <span>{item.at.toLocaleString('ru-RU')}</span>
          {item.visibility === 'INTERNAL' ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              Внутренний
            </span>
          ) : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm">
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
          <span className="font-medium text-foreground">{item.actor?.name ?? '—'}</span>{' '}
          {fromLabel
            ? `изменил(а) статус: ${fromLabel} → ${toLabel}`
            : `установил(а) статус: ${toLabel}`}
        </span>
        <span>{item.at.toLocaleString('ru-RU')}</span>
      </div>
    </li>
  );
}

/**
 * Replace `@<userId>` tokens in a comment body with inline mention
 * pills. Same logic as the server-side renderer that lived directly
 * on the page — moved here so the tabbed timeline can use it.
 */
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
        href={`/team/${u.id}`}
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
