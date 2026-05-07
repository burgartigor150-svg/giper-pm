'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import { useRealtime } from '@giper/realtime/client';
import { channelForUser } from '@giper/realtime';
import {
  getMyNotifications,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationListItem,
} from '@/actions/notifications';

type Props = {
  /** Current user id — drives the personal realtime channel subscription. */
  userId: string;
  /** Initial unread count rendered server-side so the bell doesn't pop. */
  initialUnread: number;
};

/**
 * Bell icon in the top bar. Two responsibilities:
 *
 *   1. Show a red dot + count of unread notifications. Hooked up to the
 *      realtime user channel so new pings appear without refresh.
 *   2. Open a dropdown with the latest 20 notifications. Clicking a row
 *      marks it read and navigates to the linked task. "Прочитать всё"
 *      clears every unread in one shot.
 *
 * SSR-safety: initialUnread is rendered server-side; we hydrate the
 * full list lazily on first dropdown open to keep the layout cheap.
 */
export function InboxBell({ userId, initialUnread }: Props) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationListItem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const data = await getMyNotifications();
    setItems(data.items);
    setUnread(data.unread);
  }, []);

  // Subscribe to the personal channel — every notification:new event
  // bumps the badge and (if the dropdown is open) pulls the fresh list.
  useRealtime(channelForUser(userId), useCallback((payload) => {
    const p = payload as { type?: string };
    if (p?.type === 'notification:new') {
      setUnread((c) => c + 1);
      // If the dropdown is currently visible, refresh in place so the
      // user sees the new entry without manually closing/reopening.
      setOpen((isOpen) => {
        if (isOpen) void refresh();
        return isOpen;
      });
    }
  }, [refresh]));

  // Click-outside / Esc closes.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && items === null) {
      void refresh();
    }
    setOpen((v) => !v);
  }

  function clickItem(n: NotificationListItem) {
    if (!n.isRead) {
      startTransition(async () => {
        await markNotificationReadAction(n.id);
        setUnread((c) => Math.max(0, c - 1));
        setItems((cur) =>
          cur ? cur.map((it) => (it.id === n.id ? { ...it, isRead: true } : it)) : cur,
        );
      });
    }
  }

  function readAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setUnread(0);
      setItems((cur) => (cur ? cur.map((it) => ({ ...it, isRead: true })) : cur));
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Уведомления${unread > 0 ? ` (${unread})` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-96 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-medium">Уведомления</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={readAll}
                disabled={pending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Прочитать всё
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items === null ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Загрузка…
              </p>
            ) : items.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Уведомлений пока нет.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const inner = (
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <div className="flex items-baseline gap-2">
                        {!n.isRead ? (
                          <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                        ) : (
                          <span className="mt-1 inline-block h-2 w-2 shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">{n.title}</span>
                      </div>
                      {n.body ? (
                        <p className="ml-4 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </p>
                      ) : null}
                      <span className="ml-4 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatRelative(n.createdAt)}
                      </span>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link
                          href={n.link}
                          onClick={() => {
                            clickItem(n);
                            setOpen(false);
                          }}
                          className="flex items-start gap-2 px-3 py-2 hover:bg-accent"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => clickItem(n)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent"
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatRelative(date: Date | string): string {
  const d = new Date(date);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'только что';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  return d.toLocaleDateString('ru-RU');
}
