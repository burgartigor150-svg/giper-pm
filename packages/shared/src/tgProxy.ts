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

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

let _agent: Dispatcher | null = null;
let _agentForUrl: string | null = null;
let _patched = false;

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

function isTelegramUrl(input: unknown): boolean {
  try {
    const s =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request)?.url || '';
    return s.startsWith('https://api.telegram.org');
  } catch {
    return false;
  }
}

/**
 * Drop-in replacement for global fetch that routes Telegram API calls
 * through the configured proxy dispatcher.
 */
export async function tgFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const dispatcher = tgProxyDispatcher();
  if (!dispatcher) {
    return fetch(input, init);
  }
  // undici accepts a richer init type; cast through unknown so Node's
  // RequestInit (without `dispatcher`) doesn't fight us at compile time.
  return undiciFetch(
    input,
    { ...init, dispatcher } as unknown as Parameters<typeof undiciFetch>[1],
  ) as unknown as Response;
}

/**
 * Replace the process-wide `globalThis.fetch` with a wrapper that
 * tunnels every call to api.telegram.org through the configured proxy
 * dispatcher. Other hosts (Ollama, MinIO, Postgres, …) keep using the
 * original fetch unchanged.
 *
 * This is the only reliable way to make grammY's long-poll go through
 * the proxy: grammY ships its own ApiClient that ignores per-request
 * `dispatcher` options on certain code paths, but it always uses
 * `globalThis.fetch`. Idempotent — patches once per process.
 */
export function installTelegramProxyFetch(): void {
  if (_patched) return;
  const dispatcher = tgProxyDispatcher();
  if (!dispatcher) return;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    if (isTelegramUrl(input)) {
      return undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init as Parameters<typeof undiciFetch>[1] | undefined), dispatcher },
      );
    }
    return (original as (...a: unknown[]) => Promise<Response>)(input, init);
  }) as typeof globalThis.fetch;
  _patched = true;
}
