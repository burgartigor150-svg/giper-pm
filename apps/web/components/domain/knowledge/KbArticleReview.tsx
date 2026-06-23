'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, Send, X } from 'lucide-react';
import type { KbReview } from '@/lib/knowledge/getReview';
import {
  requestReviewAction,
  approveReviewAction,
  rejectReviewAction,
  cancelReviewAction,
} from '@/actions/knowledgeReview';

type User = { id: string; name: string | null; email: string };

/** Article approval panel (TEAMLY «Согласование»): request → approve/reject. */
export function KbArticleReview({
  articleId,
  articleStatus,
  review,
  meId,
  canEdit,
  canManage,
  users,
}: {
  articleId: string;
  articleStatus: 'DRAFT' | 'PUBLISHED';
  review: KbReview | null;
  meId: string;
  canEdit: boolean;
  canManage: boolean;
  users: User[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reviewerId, setReviewerId] = useState('');

  const isPending = review?.state === 'PENDING';
  const canResolve = isPending && (review!.reviewerId === meId || canManage);
  const canCancel = isPending && (review!.requestedById === meId || canManage);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else if (res.error) alert(res.error.message);
    });
  }

  if (isPending) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
        <Clock className="h-4 w-4 text-amber-600" />
        <span className="text-amber-800 dark:text-amber-300">
          На согласовании{review!.reviewerName ? ` у ${review!.reviewerName}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {canResolve ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => approveReviewAction(review!.id))}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Одобрить
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const c = prompt('Причина отклонения (необязательно)') ?? '';
                  run(() => rejectReviewAction(review!.id, c));
                }}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
              >
                <X className="h-3.5 w-3.5" /> Отклонить
              </button>
            </>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => cancelReviewAction(review!.id))}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Отозвать
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // Not pending → show last rejection + a request form for draft articles.
  return (
    <div className="flex flex-col gap-2">
      {review?.state === 'REJECTED' ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Отклонено{review.comment ? `: ${review.comment}` : ''}
        </div>
      ) : null}
      {articleStatus === 'DRAFT' && canEdit ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Согласующий:</span>
          <select
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">— выберите —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !reviewerId}
            onClick={() => run(() => requestReviewAction(articleId, reviewerId))}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
          >
            <Send className="h-3.5 w-3.5" /> На согласование
          </button>
        </div>
      ) : null}
    </div>
  );
}
