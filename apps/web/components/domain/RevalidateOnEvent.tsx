'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@giper/realtime/client';

type Props = {
  /** Channel name to subscribe to (e.g. `task:abc` or `project:xyz`). */
  channel: string;
  /**
   * Optional filter — only refresh when the event payload's `type`
   * field matches one of these. Saves a re-render when a presence ping
   * arrives that we don't care about on this view.
   */
  eventTypes?: string[];
  /**
   * Minimum delay between consecutive refreshes. Burst protection so a
   * flood of events (e.g. someone bulk-changing 50 tasks) doesn't send
   * us into a refresh loop. Default 250ms.
   */
  throttleMs?: number;
};

/**
 * Tiny mount-only component: subscribe to a realtime channel and call
 * router.refresh() whenever a relevant event lands. The page (server
 * component) re-runs and re-renders with fresh data — no client-side
 * cache-merge logic to maintain.
 *
 * Drop one of these into a server component tree near the data it
 * affects. Multiple instances on the same page are fine; subscriptions
 * are deduped at the WebSocket level.
 */
export function RevalidateOnEvent({ channel, eventTypes, throttleMs = 250 }: Props) {
  const router = useRouter();
  const lastRef = useRef(0);

  const handler = useCallback(
    (payload: unknown) => {
      const p = payload as { type?: string };
      if (eventTypes && eventTypes.length > 0) {
        if (!p?.type || !eventTypes.includes(p.type)) return;
      }
      const now = Date.now();
      if (now - lastRef.current < throttleMs) return;
      lastRef.current = now;
      router.refresh();
    },
    [router, eventTypes, throttleMs],
  );

  useRealtime(channel, handler);
  return null;
}
