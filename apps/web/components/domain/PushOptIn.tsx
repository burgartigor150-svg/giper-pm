'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bell, X } from 'lucide-react';
import {
  subscribePushAction,
  unsubscribePushAction,
} from '@/actions/push';

const DISMISS_KEY = 'push-banner-dismissed-at';
const DISMISS_DAYS = 7;

/**
 * Cookie/localStorage-free defaults: we use localStorage for the
 * dismiss timer (per-browser, not per-account), and rely on the
 * browser's own permission store as the source of truth for "is
 * push enabled here".
 *
 * Two surfaces:
 *   - Banner that auto-appears at the top of the app when push
 *     is supported, not yet granted, and not recently dismissed.
 *   - Settings toggle (rendered by PushToggle, see below).
 */
export function PushOptInBanner() {
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      // Granted: nothing to ask. Denied: respect the user — banner
      // would be useless, they need to go into browser settings.
      return;
    }
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - dismissed < DISMISS_DAYS * 24 * 3600 * 1000) return;
    setVisible(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  function enable() {
    setError(null);
    startTransition(async () => {
      const r = await subscribeCurrentBrowser();
      if (r.ok) {
        dismiss();
      } else {
        setError(r.message);
      }
    });
  }

  if (!visible) return null;
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-sm">
      <Bell className="size-4 shrink-0 text-foreground" aria-hidden="true" />
      <div className="flex-1">
        <p>
          Включить уведомления о звонках, упоминаниях и назначениях задач?
        </p>
        {error ? <p className="mt-0.5 text-xs text-destructive">{error}</p> : null}
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {pending ? 'Подключаем…' : 'Включить'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Закрыть"
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * Settings-page toggle. Two states only — pulls the current
 * subscription on mount, subscribes/unsubscribes on click.
 */
export function PushToggle() {
  const [state, setState] = useState<'unknown' | 'on' | 'off' | 'unsupported' | 'denied'>('unknown');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      if (state === 'on') {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await unsubscribePushAction(sub.endpoint);
          await sub.unsubscribe().catch(() => undefined);
        }
        setState('off');
      } else if (state === 'off') {
        const r = await subscribeCurrentBrowser();
        if (r.ok) setState('on');
        else setError(r.message);
      }
    });
  }

  if (state === 'unsupported') {
    return (
      <p className="text-sm text-muted-foreground">
        Этот браузер не поддерживает push-уведомления.
      </p>
    );
  }
  if (state === 'denied') {
    return (
      <p className="text-sm text-muted-foreground">
        Уведомления заблокированы в настройках браузера. Откройте настройки сайта и разрешите
        уведомления вручную.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || state === 'unknown'}
        className={
          'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
          (state === 'on'
            ? 'border-foreground bg-foreground text-background hover:bg-foreground/90'
            : 'border-input bg-background hover:bg-muted')
        }
      >
        <Bell className="size-3.5" />
        {state === 'on' ? 'Push-уведомления включены' : 'Включить push-уведомления'}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Shared helper used by both banner and toggle. Handles:
 *   1. SW registration
 *   2. permission request
 *   3. pushManager.subscribe with the server's VAPID public key
 *   4. server-side persistence via subscribePushAction
 *
 * Returns a result envelope rather than throwing — both callers
 * want to render the failure inline.
 */
async function subscribeCurrentBrowser(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return { ok: false, message: 'Браузер не поддерживает push-уведомления' };
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return { ok: false, message: 'Нужно разрешить уведомления в браузере' };
    }
    // Get / register service worker. We register at "/" scope so the
    // SW controls every page.
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    // Fetch VAPID public key — server may not be configured.
    const res = await fetch('/api/push/vapid-public-key');
    if (!res.ok) {
      return { ok: false, message: 'Push не настроен на сервере' };
    }
    const { enabled, publicKey } = await res.json();
    if (!enabled || !publicKey) {
      return { ok: false, message: 'Push не настроен на сервере' };
    }
    // Cast: TS dom types want BufferSource (ArrayBuffer/SharedArrayBuffer);
    // Uint8Array IS a BufferSource at runtime in every browser, but the
    // lib.dom.d.ts version on this branch is strict. Buffer it through
    // .buffer to satisfy the typechecker without copying.
    const key = urlBase64ToUint8Array(publicKey);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(
        key.byteOffset,
        key.byteOffset + key.byteLength,
      ) as ArrayBuffer,
    });
    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!json.endpoint || !p256dh || !auth) {
      return { ok: false, message: 'Не удалось подписаться' };
    }
    const r = await subscribePushAction({
      endpoint: json.endpoint,
      p256dh,
      authSec: auth,
      userAgent: navigator.userAgent,
    });
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Не удалось включить уведомления',
    };
  }
}

/**
 * VAPID public key arrives base64-url; PushManager wants a Uint8Array.
 * Standard conversion lifted from the W3C example.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
