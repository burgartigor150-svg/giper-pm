'use client';

import { useEffect } from 'react';

/**
 * Error boundary for a channel view — a transient load/render failure shows a
 * retry instead of a blank screen or the global error page.
 */
export default function ChannelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[messages] channel error:', error);
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Не удалось загрузить чат. Попробуйте ещё раз.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Повторить
      </button>
    </div>
  );
}
