'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Send } from 'lucide-react';
import { publishProjectAction } from '@/actions/projects';
import { publishTaskAction } from '@/actions/tasks';

type ProjectProps = {
  kind: 'project';
  projectId: string;
  /** When already linked, we render a passive "linked" indicator instead. */
  alreadyLinked: boolean;
};
type TaskProps = {
  kind: 'task';
  taskId: string;
  projectKey: string;
  taskNumber: number;
  alreadyLinked: boolean;
  /** Parent project mirrored — required for the button to appear. */
  projectMirrored: boolean;
};
type Props = ProjectProps | TaskProps;

/**
 * "Опубликовать в Bitrix" affordance for already-created local items.
 * Two flavours of the same UX:
 *   - already linked → passive badge "Опубликовано", no action.
 *   - parent project not mirrored (tasks only) → disabled with hint.
 *   - otherwise → a Send-arrow button that calls the publish action
 *     and reports the resulting bitrixId on success.
 */
export function PublishToBitrixButton(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (props.alreadyLinked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
        <ExternalLink className="h-3 w-3" />
        Опубликовано в Bitrix
      </span>
    );
  }

  if (props.kind === 'task' && !props.projectMirrored) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground opacity-60"
        title="Сначала опубликуйте проект в Bitrix24"
      >
        <Send className="h-3 w-3" />
        Опубликовать в Bitrix
      </button>
    );
  }

  function publish() {
    setError(null);
    startTransition(async () => {
      const res =
        props.kind === 'project'
          ? await publishProjectAction(props.projectId)
          : await publishTaskAction(props.taskId, props.projectKey, props.taskNumber);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={publish}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-60"
      >
        <Send className="h-3 w-3" />
        {pending ? 'Публикуем…' : 'Опубликовать в Bitrix'}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}
