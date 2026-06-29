'use client';

import { useState, useTransition } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { acceptTestingAction, returnFromTestingAction } from '@/actions/testing';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** Whether the *current viewer* is the assigned tester (or holds task.testing.close). */
  canTest: boolean;
  /** Internal status — actions only show when TESTING. */
  internalStatus: string;
};

/**
 * Shown on the task detail page when the viewing user is the tester and
 * the task sits in TESTING. Accept moves it on to REVIEW; Return expands a
 * textarea for the required reason and sends it back to IN_PROGRESS.
 * Mirrors ReviewerActions; a cyan accent keeps it visually distinct from
 * the reviewer's violet panel.
 */
export function TesterActions({
  taskId,
  projectKey,
  taskNumber,
  canTest,
  internalStatus,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canTest || internalStatus !== 'TESTING') return null;

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptTestingAction(taskId, projectKey, taskNumber);
      if (!res.ok) setError(res.error.message);
    });
  }

  function handleReturn() {
    setError(null);
    if (reason.trim().length < 3) {
      setError('Опишите причину');
      return;
    }
    startTransition(async () => {
      const res = await returnFromTestingAction(taskId, projectKey, taskNumber, reason);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setReturnOpen(false);
        setReason('');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-cyan-300 bg-cyan-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
        Решение тестировщика
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleAccept}
          disabled={pending}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Check className="mr-1 h-4 w-4" />
          Принять тестирование
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReturnOpen((v) => !v)}
          disabled={pending}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Вернуть на доработку
        </Button>
      </div>
      {returnOpen ? (
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
              onClick={handleReturn}
              disabled={pending || reason.trim().length < 3}
            >
              Отправить
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setReturnOpen(false);
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
