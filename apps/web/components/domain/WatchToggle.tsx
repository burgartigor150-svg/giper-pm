'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toggleWatcherAction } from '@/actions/watchers';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  initialWatching: boolean;
  /**
   * When true, the user is implicitly a watcher (they're the assignee
   * or creator). We render a disabled button with a tooltip instead of
   * the toggle, since unsubscribing wouldn't actually stop pings.
   */
  implicit: boolean;
};

/**
 * 👁 button on a task page. Toggles the user's explicit watch
 * subscription. Optimistic — the icon flips immediately, the server
 * action confirms in the background.
 */
export function WatchToggle({ taskId, projectKey, taskNumber, initialWatching, implicit }: Props) {
  const [watching, setWatching] = useState(initialWatching);
  const [pending, startTransition] = useTransition();

  if (implicit) {
    return (
      <button
        type="button"
        disabled
        title="Вы автоматически отслеживаете задачу как назначенный/автор"
        className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground opacity-70"
      >
        <Eye className="h-3.5 w-3.5" />
        Отслеживается
      </button>
    );
  }

  function toggle() {
    startTransition(async () => {
      // Optimistic flip; revert on failure.
      const next = !watching;
      setWatching(next);
      const res = await toggleWatcherAction(taskId, projectKey, taskNumber);
      if (!res.ok) {
        setWatching(!next);
      } else {
        setWatching(res.watching);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={watching ? 'Перестать следить — больше не получать уведомления' : 'Следить — получать уведомления о комментариях и смене статуса'}
      className={
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ' +
        (watching
          ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'border-input text-muted-foreground hover:bg-accent')
      }
    >
      {watching ? (
        <>
          <Eye className="h-3.5 w-3.5" />
          Слежу
        </>
      ) : (
        <>
          <EyeOff className="h-3.5 w-3.5" />
          Следить
        </>
      )}
    </button>
  );
}
