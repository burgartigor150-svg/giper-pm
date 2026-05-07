'use client';

import { useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { CheckCircle2 } from 'lucide-react';
import { setInternalStatusAction } from '@/actions/assignments';

type ChecklistShape = {
  items: { isDone: boolean }[];
};

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  internalStatus: string;
  checklists: ChecklistShape[];
};

/**
 * Subtle green CTA that appears once every checklist item on the task
 * is checked AND the task is still pre-review. Click moves the task
 * to REVIEW (internal track only — Bitrix mirror status untouched).
 *
 * Doesn't auto-flip the status because surprise transitions feel
 * controlling; surfacing the next-best-step to the user is the
 * Agile-friendly compromise.
 */
export function SendToReviewCTA({
  taskId,
  projectKey,
  taskNumber,
  internalStatus,
  checklists,
}: Props) {
  const [pending, startTransition] = useTransition();

  const allItems = checklists.flatMap((c) => c.items);
  const ready =
    allItems.length > 0 &&
    allItems.every((i) => i.isDone) &&
    (internalStatus === 'BACKLOG' ||
      internalStatus === 'TODO' ||
      internalStatus === 'IN_PROGRESS');

  if (!ready) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        Все пункты чек-листов выполнены — можно отправить на ревью.
      </div>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await setInternalStatusAction(
              taskId,
              projectKey,
              taskNumber,
              'REVIEW',
            );
          });
        }}
      >
        {pending ? 'Перевожу…' : 'Отправить на ревью'}
      </Button>
    </div>
  );
}
