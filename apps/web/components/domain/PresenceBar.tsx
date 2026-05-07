'use client';

import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { useRealtime } from '@giper/realtime/client';
import { channelForTask } from '@giper/realtime';
import { lookupPresenceUsers, type PresenceUser } from '@/actions/presence';

type Props = {
  taskId: string;
  /** Current viewer's id — filtered out of the displayed list. */
  meId: string;
};

/**
 * Live "who else is looking at this task right now" indicator. Subscribes
 * to the task channel and updates on every presence:state event, then
 * resolves user ids → display names + avatars via a server action.
 *
 * Behavior notes:
 *   - The current viewer is hidden from the bar (you don't need to see
 *     yourself, you know you're here).
 *   - We cap displayed avatars at 5 with a "+N" pill for the rest.
 *   - Initial render shows nothing — the first presence:state arrives a
 *     few hundred ms after subscribe, which is fast enough that flashing
 *     an empty bar would be more noise than value.
 */
export function PresenceBar({ taskId, meId }: Props) {
  const [otherIds, setOtherIds] = useState<string[]>([]);
  const [users, setUsers] = useState<Map<string, PresenceUser>>(new Map());

  const onEvent = useCallback(
    (payload: unknown) => {
      const p = payload as { type?: string; userIds?: string[] };
      if (p?.type !== 'presence:state' || !Array.isArray(p.userIds)) return;
      const filtered = p.userIds.filter((id) => id !== meId);
      setOtherIds(filtered);
    },
    [meId],
  );
  useRealtime(channelForTask(taskId), onEvent);

  // Resolve missing users when the id list changes. Cache in state so we
  // don't refetch a viewer who hasn't moved between renders.
  useEffect(() => {
    const missing = otherIds.filter((id) => !users.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    lookupPresenceUsers(missing).then((rows) => {
      if (cancelled) return;
      setUsers((cur) => {
        const next = new Map(cur);
        for (const u of rows) next.set(u.id, u);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [otherIds, users]);

  if (otherIds.length === 0) return null;

  const visibleIds = otherIds.slice(0, 5);
  const overflow = otherIds.length - visibleIds.length;

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
      <span className="text-muted-foreground">Сейчас смотрят:</span>
      <div className="flex -space-x-1">
        {visibleIds.map((id) => {
          const u = users.get(id);
          return (
            <Avatar
              key={id}
              src={u?.image ?? null}
              alt={u?.name ?? '?'}
              className="h-5 w-5 ring-2 ring-background"
            />
          );
        })}
        {overflow > 0 ? (
          <span className="ml-2 inline-flex h-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  );
}
