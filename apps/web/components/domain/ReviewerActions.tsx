'use client';

import { useState, useTransition } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { approveTaskAction, rejectTaskAction } from '@/actions/review';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** Whether the *current viewer* is the assigned reviewer (or ADMIN/PM). */
  canReview: boolean;
  /** Internal status — actions only show when REVIEW. */
  internalStatus: string;
};

/**
 * Shown on the task detail page when the viewing user is the reviewer
 * and the task sits in REVIEW. Approve closes immediately; Reject
 * expands a textarea for the required reason.
 */
export function ReviewerActions({
  taskId,
  projectKey,
  taskNumber,
  canReview,
  internalStatus,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canReview || internalStatus !== 'REVIEW') return null;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveTaskAction(taskId, projectKey, taskNumber);
      if (!res.ok) setError(res.error.message);
    });
  }

  function handleReject() {
    setError(null);
    if (reason.trim().length < 3) {
      setError('Опишите причину');
      return;
    }
    startTransition(async () => {
      const res = await rejectTaskAction(taskId, projectKey, taskNumber, reason);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setRejectOpen(false);
        setReason('');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-purple-300 bg-purple-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-purple-900">
        Решение ревьюера
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleApprove}
          disabled={pending}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Check className="mr-1 h-4 w-4" />
          Одобрить
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRejectOpen((v) => !v)}
          disabled={pending}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Вернуть на доработку
        </Button>
      </div>
      {rejectOpen ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Что не так? (комментарий уйдёт исполнителю)"
            rows={3}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleReject}
              disabled={pending || reason.trim().length < 3}
            >
              Отправить
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejectOpen(false);
                setReason('');
              }}
              disabled={pending}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
