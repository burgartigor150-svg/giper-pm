'use client';

import { useState, useTransition } from 'react';
import { MessageSquare, Reply, SmilePlus, Trash2 } from 'lucide-react';
import type { KbCommentNode, KbReactionGroup } from '@/lib/knowledge/getComments';
import {
  addCommentAction,
  updateCommentAction,
  deleteCommentAction,
  toggleArticleReactionAction,
  toggleCommentReactionAction,
} from '@/actions/knowledgeComments';

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '👀', '✅', '🔥'];

/** Article discussion: emoji reactions + threaded (one level) comments. */
export function KbComments({
  articleId,
  comments,
  articleReactions,
  meId,
  canComment,
  canManage,
}: {
  articleId: string;
  comments: KbCommentNode[];
  articleReactions: KbReactionGroup[];
  meId: string;
  canComment: boolean;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');

  const count = comments.reduce((n, c) => n + 1 + c.replies.length, 0);

  function addTop() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await addCommentAction(articleId, text);
      if (res.ok) setBody('');
      else alert(res.error.message);
    });
  }

  return (
    <section className="mt-8 flex flex-col gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <ReactionBar
        groups={articleReactions}
        disabled={!canComment || pending}
        onToggle={(emoji) =>
          startTransition(async () => {
            const r = await toggleArticleReactionAction(articleId, emoji);
            if (!r.ok) alert(r.error.message);
          })
        }
      />

      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <MessageSquare className="h-4 w-4" /> Комментарии {count > 0 ? `· ${count}` : ''}
      </h2>

      {canComment ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Написать комментарий…"
            rows={2}
            className="w-full resize-y rounded-md border border-neutral-300 p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={addTop}
            disabled={pending || !body.trim()}
            className="w-fit rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Отправить
          </button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            articleId={articleId}
            comment={c}
            meId={meId}
            canComment={canComment}
            canManage={canManage}
            pending={pending}
            startTransition={startTransition}
            depth={0}
          />
        ))}
        {comments.length === 0 ? (
          <li className="text-sm text-muted-foreground">Пока нет комментариев.</li>
        ) : null}
      </ul>
    </section>
  );
}

function ReactionBar({
  groups,
  disabled,
  onToggle,
}: {
  groups: KbReactionGroup[];
  disabled: boolean;
  onToggle: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const present = new Set(groups.map((g) => g.emoji));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(g.emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            g.mine ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40' : 'border-neutral-300 dark:border-neutral-700'
          }`}
        >
          <span>{g.emoji}</span> <span className="text-muted-foreground">{g.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 text-muted-foreground hover:text-foreground disabled:opacity-50 dark:border-neutral-700"
          aria-label="Добавить реакцию"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
        {open ? (
          <div className="absolute left-0 z-50 mt-1 flex gap-1 rounded-lg border border-neutral-200 bg-background p-1 shadow-lg dark:border-neutral-700">
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onToggle(e);
                  setOpen(false);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-muted ${present.has(e) ? 'bg-muted' : ''}`}
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommentItem({
  articleId,
  comment,
  meId,
  canComment,
  canManage,
  pending,
  startTransition,
  depth,
}: {
  articleId: string;
  comment: KbCommentNode;
  meId: string;
  canComment: boolean;
  canManage: boolean;
  pending: boolean;
  startTransition: (cb: () => void) => void;
  depth: number;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  const mine = comment.authorId === meId;
  const canDelete = mine || canManage;

  function react(emoji: string) {
    startTransition(async () => {
      const r = await toggleCommentReactionAction(comment.id, emoji);
      if (!r.ok) alert(r.error.message);
    });
  }
  function sendReply() {
    const text = replyBody.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await addCommentAction(articleId, text, comment.id);
      if (r.ok) {
        setReplyBody('');
        setReplying(false);
      } else alert(r.error.message);
    });
  }
  function saveEdit() {
    startTransition(async () => {
      const r = await updateCommentAction(comment.id, editBody);
      if (r.ok) setEditing(false);
      else alert(r.error.message);
    });
  }
  function remove() {
    if (!confirm('Удалить комментарий?')) return;
    startTransition(async () => {
      const r = await deleteCommentAction(comment.id);
      if (!r.ok) alert(r.error.message);
    });
  }

  return (
    <li className={depth > 0 ? 'ml-6 border-l border-neutral-200 pl-3 dark:border-neutral-800' : ''}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{comment.authorName ?? 'Пользователь'}</span>
          <span>{new Date(comment.createdAt).toLocaleString('ru-RU')}</span>
        </div>

        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveEdit} disabled={pending} className="rounded bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-white dark:text-neutral-900">
                Сохранить
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {comment.reactions.map((g) => (
            <button
              key={g.emoji}
              type="button"
              disabled={!canComment || pending}
              onClick={() => react(g.emoji)}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                g.mine ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40' : 'border-neutral-300 dark:border-neutral-700'
              }`}
            >
              {g.emoji} <span className="text-muted-foreground">{g.count}</span>
            </button>
          ))}
          {canComment ? (
            <button type="button" disabled={pending} onClick={() => react('👍')} className="text-muted-foreground hover:text-foreground" aria-label="Лайк">
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {canComment && depth === 0 ? (
            <button type="button" onClick={() => setReplying((r) => !r)} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
              <Reply className="h-3.5 w-3.5" /> Ответить
            </button>
          ) : null}
          {mine ? (
            <button type="button" onClick={() => setEditing((e) => !e)} className="text-xs text-muted-foreground hover:text-foreground">
              Изменить
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" onClick={remove} disabled={pending} className="text-muted-foreground hover:text-red-600" aria-label="Удалить">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {replying ? (
          <div className="mt-1 flex flex-col gap-1">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Ответить…"
              rows={2}
              className="w-full resize-y rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button type="button" onClick={sendReply} disabled={pending || !replyBody.trim()} className="w-fit rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
              Ответить
            </button>
          </div>
        ) : null}
      </div>

      {comment.replies.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3">
          {comment.replies.map((r) => (
            <CommentItem
              key={r.id}
              articleId={articleId}
              comment={r}
              meId={meId}
              canComment={canComment}
              canManage={canManage}
              pending={pending}
              startTransition={startTransition}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
