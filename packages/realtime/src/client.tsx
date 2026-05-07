'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Single shared WebSocket connection per page tab. Mounted once at the
 * AppShell root via <RealtimeProvider/>; consumers subscribe through the
 * <code>useRealtime(channel, handler)</code> hook.
 *
 * Reconnect strategy: exponential backoff capped at 30s. On each
 * reconnect we re-send subscribe messages for every channel that has a
 * registered handler, so consumers don't lose events across a network
 * blip.
 *
 * Token renewal: the provider takes a `getToken` callback that returns
 * a fresh JWT (typically a server action). When we get a connection-
 * close with code 4001 ("token expired") we call it again to retry.
 */

type EventHandler = (payload: unknown) => void;

type RealtimeCtx = {
  status: 'idle' | 'connecting' | 'open' | 'closed';
  subscribe: (channel: string, handler: EventHandler) => () => void;
};

const Ctx = createContext<RealtimeCtx | null>(null);

type Props = {
  /** The wss://... URL of the giper-pm WS server, without `?token=`. */
  url: string;
  /** Server action / fetch that returns a fresh auth token. */
  getToken: () => Promise<string>;
  children: ReactNode;
};

export function RealtimeProvider({ url, getToken, children }: Props) {
  const [status, setStatus] = useState<RealtimeCtx['status']>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const backoffRef = useRef(500);
  const closingRef = useRef(false);

  const sendSubscribe = useCallback((channel: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const sendUnsubscribe = useCallback((channel: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  const connect = useCallback(async () => {
    if (closingRef.current) return;
    setStatus('connecting');
    let token: string;
    try {
      token = await getToken();
    } catch {
      // Auth not available (e.g. user not logged in yet on a public
      // page that mounted us by accident). Stay quiet and retry later.
      setStatus('closed');
      scheduleReconnect();
      return;
    }
    const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setStatus('open');
      backoffRef.current = 500;
      // Re-subscribe to everything we care about.
      for (const channel of handlersRef.current.keys()) {
        sendSubscribe(channel);
      }
    });

    ws.addEventListener('message', (evt) => {
      let msg: { type?: string; channel?: string; payload?: unknown };
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'event' && typeof msg.channel === 'string') {
        const handlers = handlersRef.current.get(msg.channel);
        if (!handlers) return;
        for (const h of handlers) {
          try {
            h(msg.payload);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[realtime] handler threw', e);
          }
        }
      }
    });

    ws.addEventListener('close', () => {
      setStatus('closed');
      wsRef.current = null;
      if (!closingRef.current) scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close fires too; we don't need to do anything here.
    });
  }, [url, getToken, sendSubscribe]);

  const scheduleReconnect = useCallback(() => {
    if (closingRef.current) return;
    const delay = backoffRef.current;
    backoffRef.current = Math.min(delay * 2, 30_000);
    setTimeout(() => {
      void connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    closingRef.current = false;
    void connect();
    return () => {
      closingRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const subscribe = useCallback(
    (channel: string, handler: EventHandler) => {
      let set = handlersRef.current.get(channel);
      const wasEmpty = !set || set.size === 0;
      if (!set) {
        set = new Set();
        handlersRef.current.set(channel, set);
      }
      set.add(handler);
      if (wasEmpty) {
        // First handler for this channel — tell the server we want it.
        sendSubscribe(channel);
      }
      return () => {
        const cur = handlersRef.current.get(channel);
        if (!cur) return;
        cur.delete(handler);
        if (cur.size === 0) {
          handlersRef.current.delete(channel);
          sendUnsubscribe(channel);
        }
      };
    },
    [sendSubscribe, sendUnsubscribe],
  );

  const ctxValue = useMemo<RealtimeCtx>(
    () => ({ status, subscribe }),
    [status, subscribe],
  );

  // Concurrent @types/react versions in the monorepo make Ctx.Provider
  // resolve as an incompatible JSX type. The runtime is identical;
  // silence the structural mismatch.
  const Provider = Ctx.Provider as unknown as (props: {
    value: RealtimeCtx;
    children: ReactNode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => any;
  return <Provider value={ctxValue}>{children}</Provider>;
}

/**
 * Subscribe to a channel and run `handler` on every event. The handler
 * is wrapped in a ref so updates don't tear down the subscription —
 * callers can pass an inline closure without worrying about reconnects.
 */
export function useRealtime(channel: string | null, handler: EventHandler) {
  const ctx = useContext(Ctx);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx || !channel) return;
    return ctx.subscribe(channel, (payload) => handlerRef.current(payload));
  }, [ctx, channel]);
}

/**
 * Read connection status — useful to show a "you're offline" indicator
 * on long-lived screens like the kanban board.
 */
export function useRealtimeStatus(): RealtimeCtx['status'] {
  const ctx = useContext(Ctx);
  return ctx?.status ?? 'idle';
}
