'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive } from 'lucide-react';
import { archivePipelineAction } from '@/actions/crm';

/**
 * Archive (soft-delete) the currently-open pipeline. ADMIN only — the
 * server action re-checks canDeleteCrmPipeline. Deals are kept; the
 * pipeline just drops out of listPipelines (archivedAt filter).
 */
export function ArchivePipelineButton({
  pipelineId,
  pipelineName,
}: {
  pipelineId: string;
  pipelineName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function archive() {
    // eslint-disable-next-line no-alert
    const sure = window.confirm(
      `Архивировать воронку «${pipelineName}»? Сделки сохранятся, но воронка скроется из списка.`,
    );
    if (!sure) return;
    startTransition(async () => {
      const res = await archivePipelineAction(pipelineId);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.push('/crm');
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={archive}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      aria-label={`Архивировать воронку ${pipelineName}`}
      title="Архивировать воронку"
    >
      <Archive className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Архивировать</span>
    </button>
  );
}
