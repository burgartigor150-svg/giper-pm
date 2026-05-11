// giper-pm service worker — push notifications + click routing.
//
// We deliberately keep this file tiny: no caching, no offline fallback,
// no PWA install logic. Adding Workbox-style caching here is one of
// those decisions that's hard to reverse (cached HTML pinned to old
// builds), so it gets its own ticket if we ever need offline support.

self.addEventListener('install', (event) => {
  // Take over immediately so a fresh deploy doesn't sit waiting for
  // every open tab to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push event handler. Payload is the JSON we wrote in
 * lib/push/sendPush.ts (PushPayload).
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Some pushes are plain-text pings (no body). Show a generic
    // toast in that case rather than swallowing the event.
    payload = { title: 'giper-pm', body: event.data.text() };
  }
  const { title = 'giper-pm', body, url, tag, icon, data } = payload || {};
  const notif = {
    body: body || '',
    tag: tag || undefined,
    icon: icon || '/favicon.ico',
    badge: '/favicon.ico',
    // Click data — we read this in `notificationclick` to navigate.
    data: { ...(data || {}), url: url || '/' },
    // Renotify with the same tag (so a re-fired "Игорь зовёт" replaces
    // the previous toast instead of stacking).
    renotify: !!tag,
  };
  event.waitUntil(self.registration.showNotification(title, notif));
});

/**
 * On click: focus an existing tab whose path matches the target URL,
 * otherwise open a fresh window. Closes the notification either way.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Try to focus an existing same-origin tab and navigate it.
      for (const c of all) {
        try {
          const u = new URL(c.url);
          if (u.origin === self.location.origin) {
            await c.focus();
            // navigate() works in Chrome / Firefox / Safari 16.4+.
            if ('navigate' in c) {
              await c.navigate(new URL(target, self.location.origin).toString());
            }
            return;
          }
        } catch {
          /* swallow malformed URL */
        }
      }
      // No matching tab — open a new one.
      await self.clients.openWindow(target);
    })(),
  );
});
