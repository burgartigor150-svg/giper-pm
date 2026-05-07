/**
 * Server-side publish helper. Used by Next.js server actions and webhook
 * handlers to push events to subscribed browsers via the WS server.
 *
 * Failure mode: best-effort. If the WS server is down, we log and
 * continue — the user's primary action (status change, new comment)
 * already succeeded against the database. Missing a real-time push
 * means the team sees the change on next page revalidate, which is
 * still seconds-fast — the cost of a hard fail would be unacceptable.
 */

export async function publishRealtime(opts: {
  channel: string;
  payload: unknown;
  /** Override the default WS publish endpoint (e.g. for tests). */
  url?: string;
  secret?: string;
  /** Drop the call entirely if the env isn't configured. */
  optional?: boolean;
}): Promise<{ ok: boolean; delivered?: number; error?: string }> {
  const url = opts.url ?? process.env.WS_PUBLISH_URL?.trim();
  const secret = opts.secret ?? process.env.WS_PUBLISH_SECRET?.trim();
  if (!url || !secret) {
    if (opts.optional !== false) return { ok: false, error: 'not configured' };
    throw new Error('WS_PUBLISH_URL and WS_PUBLISH_SECRET must be set');
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ channel: opts.channel, payload: opts.payload }),
      // Keep the server-action snappy — if the WS box is wedged we
      // shouldn't block the user's request behind a 30 s default fetch.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { delivered?: number };
    return { ok: true, delivered: body.delivered };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
