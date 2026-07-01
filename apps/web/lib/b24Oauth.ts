/**
 * Bitrix24 OAuth 2.0 — server-side flow helpers, ported from the proven
 * hr.promo-giper-ai.ru implementation. Bitrix24 is NOT RFC-compliant (token
 * response omits token_type, client creds go in query params not Basic auth,
 * user.current is a REST call with `auth` in the body), which is why we drive
 * the flow by hand instead of using a standard OAuth library / NextAuth OAuth
 * provider. Docs: https://training.bitrix24.com/rest_help/oauth/index.php
 */

const PORTAL = (process.env.BITRIX24_PORTAL?.trim() || 'giper.bitrix24.ru')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
const CLIENT_ID = process.env.BITRIX24_OAUTH_CLIENT_ID?.trim() || '';
const CLIENT_SECRET = process.env.BITRIX24_OAUTH_CLIENT_SECRET?.trim() || '';

/** True when both OAuth creds are set — gates the provider + the routes. */
export function isBitrix24OauthConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/** Authorize URL for the redirect-to-Bitrix24 step. No scope param — the local
 *  application's own scopes apply (matches the HR app). */
export function b24AuthorizeUrl(state: string, redirectUri: string): string {
  const u = new URL(`https://${PORTAL}/oauth/authorize/`);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export type B24TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  member_id?: string;
  user_id?: number;
  domain?: string;
  client_endpoint?: string;
  server_endpoint?: string;
  error?: string;
  error_description?: string;
};

/** Exchange the authorization code for tokens. Bitrix24's token endpoint is the
 *  central oauth.bitrix.info (GET with query params, creds in the query). */
export async function b24ExchangeCode(code: string, redirectUri: string): Promise<B24TokenResponse> {
  const u = new URL('https://oauth.bitrix.info/oauth/token/');
  u.searchParams.set('grant_type', 'authorization_code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('client_secret', CLIENT_SECRET);
  u.searchParams.set('code', code);
  u.searchParams.set('redirect_uri', redirectUri);
  const r = await fetch(u, { method: 'GET' });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`B24 token exchange failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as B24TokenResponse;
}

export type B24CurrentUser = {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
  PERSONAL_PHOTO?: string;
};

/** Fetch the authenticated user via user.current. Uses the token's own
 *  client_endpoint (handles portal redirects), with `auth` in the POST body. */
export async function b24FetchCurrentUser(token: B24TokenResponse): Promise<B24CurrentUser | null> {
  const base = (token.client_endpoint || `https://${token.domain || PORTAL}/rest/`).replace(/\/$/, '');
  const r = await fetch(`${base}/user.current.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth: token.access_token }).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`B24 user.current failed: ${r.status} ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { result?: B24CurrentUser; error?: string };
  if (j.error) throw new Error(`B24 user.current error: ${j.error}`);
  return j.result ?? null;
}
