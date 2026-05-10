/**
 * Telegram-API proxy helper.
 *
 * The production server lives in .ru where Telegram is blocked at the
 * network layer (RKN). When `TG_PROXY_URL` is set we tunnel every call
 * to api.telegram.org through it. Empty/unset → direct connect (works
 * out of .ru, dev machines).
 *
 * Supported proxy URL formats (parsed by undici's ProxyAgent):
 *   - http://host:port
 *   - http://user:pass@host:port
 *   - https://host:port
 *
 * SOCKS5 is NOT supported by undici directly — use the HTTP-proxy
 * inbound of your xray/v2ray instead (xray exposes both on different
 * ports).
 */

import { ProxyAgent, type Dispatcher } from 'undici';

let _agent: Dispatcher | null = null;
let _agentForUrl: string | null = null;

export function tgProxyUrl(): string | null {
  const url = process.env.TG_PROXY_URL?.trim();
  return url ? url : null;
}

/**
 * Returns an undici Dispatcher pre-configured to route through the
 * Telegram proxy, or `undefined` when no proxy is configured. Cached
 * per-process.
 */
export function tgProxyDispatcher(): Dispatcher | undefined {
  const url = tgProxyUrl();
  if (!url) return undefined;
  if (_agent && _agentForUrl === url) return _agent;
  _agent = new ProxyAgent({
    uri: url,
    requestTls: { rejectUnauthorized: true },
  });
  _agentForUrl = url;
  return _agent;
}

/**
 * Drop-in replacement for global fetch that adds the proxy dispatcher
 * when configured. Use for any call that goes to api.telegram.org or
 * Telegram CDN (`https://api.telegram.org/file/bot…`).
 */
export async function tgFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const dispatcher = tgProxyDispatcher();
  if (!dispatcher) {
    return fetch(input, init);
  }
  // Cast: Node's RequestInit doesn't list `dispatcher` but undici's
  // global fetch reads it.
  return fetch(input, { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher });
}
