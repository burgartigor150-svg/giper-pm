'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Periodically re-runs the current (server) route so freshly-synced data —
 * new comments, status changes, Bitrix-mirrored activity — appears without a
 * manual page reload. `router.refresh()` refetches server components and
 * reconciles them into the live tree, so client state (e.g. a half-typed
 * comment in CommentForm) is preserved.
 *
 * Polls only while the tab is visible, and refreshes immediately on regaining
 * focus so switching back to the tab shows the latest at once.
 */
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') router.refresh();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
