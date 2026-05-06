'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { startTimerAction, stopTimerAction } from '@/actions/time';
import { useT } from '@/lib/useT';
import { LiveDuration } from './LiveDuration';

type Props = {
  taskId: string;
  /** Active timer of the current user, if any. */
  activeTimer:
    | {
        taskId: string | null;
        startedAt: Date | string;
        task: { number: number; title: string; project: { key: string } } | null;
      }
    | null;
};

export function TaskTimerButton({ taskId, activeTimer }: Props) {
  const t = useT('time.timer');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isRunningHere = activeTimer?.taskId === taskId;
  const isRunningElsewhere = activeTimer && !isRunningHere;

  function start() {
    if (isRunningElsewhere && activeTimer?.task) {
      const current = `${activeTimer.task.project.key}-${activeTimer.task.number} ${activeTimer.task.title}`;
      const ok = confirm(
        t('switchBody', { current, next: 'эту задачу' }),
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await startTimerAction(taskId);
      if (res.ok) router.refresh();
    });
  }

  function stop() {
    startTransition(async () => {
      const res = await stopTimerAction();
      if (res.ok) router.refresh();
    });
  }

  if (isRunningHere && activeTimer) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={stop}
      >
        <Pause className="h-4 w-4" />
        <span>{t('stop')}</span>
        <span className="ml-2 font-mono text-xs">
          <LiveDuration startedAt={activeTimer.startedAt} />
        </span>
      </Button>
    );
  }

  return (
    <Button type="button" size="sm" disabled={pending} onClick={start}>
      <Play className="h-4 w-4" />
      <span>{t('start')}</span>
    </Button>
  );
}
