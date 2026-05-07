'use client';

import { Plus } from 'lucide-react';

type Props = {
  parentTaskId: string;
  projectKey: string;
};

/**
 * Tiny client-side island: dispatches `giper:quick-add-task` with the
 * `parentTaskId` and `projectKey` in the event detail. The shared
 * QuickAddDialog (mounted at AppShell root) catches this and pre-fills
 * accordingly. Same modal used by the C shortcut globally.
 */
export function AddSubtaskButton({ parentTaskId, projectKey }: Props) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent('giper:quick-add-task', {
            detail: { parentTaskId, projectKey },
          }),
        );
      }}
      className="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Plus className="h-3 w-3" />
      Подзадача
    </button>
  );
}
