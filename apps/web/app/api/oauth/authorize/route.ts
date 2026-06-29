import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { auth } from '@/lib/auth';
import {
  randomToken,
  sha256,
  CODE_TTL_SEC,
  baseUrl,
  signConsentToken,
  verifyConsentToken,
  type ConsentBinding,
} from '@/lib/oauth/core';

/**
 * OAuth Authorization Endpoint (Authorization Code + PKCE).
 *
 * Login reuses the giper-pm session: this route does its OWN auth() and bounces
 * an unauthenticated browser to /login, returning here afterwards. We then show
 * a consent screen on GET; APPROVAL happens via POST carrying a signed consent
 * token (CSRF defense — see lib/oauth/core). On approval we mint a single-use
 * code bound to the PKCE challenge and redirect back to the client.
 */
export const dynamic = 'force-dynamic';

function errorPage(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
     <h2>Ошибка авторизации</h2><p>${escapeHtml(message)}</p></body>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string | null;
}

function readParams(p: URLSearchParams): AuthorizeParams {
  return {
    responseType: p.get('response_type') ?? '',
    clientId: p.get('client_id') ?? '',
    redirectUri: p.get('redirect_uri') ?? '',
    codeChallenge: p.get('code_challenge') ?? '',
    codeChallengeMethod: p.get('code_challenge_method') ?? '',
    state: p.get('state') ?? '',
    // Treat an empty form field the same as an absent query param (→ null), so
    // the stored auth-code scope matches the GET and POST paths.
    scope: p.get('scope') || null,
  };
}

/**
 * Shared validation for GET (render) and POST (approve). Returns either a
 * Response to send immediately (client lookup / redirect_uri / protocol error,
 * or a login bounce) or the resolved client + session for the happy path.
 */
async function validate(
  params: AuthorizeParams,
  selfUrlForLogin: string,
): Promise<
  | { kind: 'response'; res: Response }
  | { kind: 'ok'; client: { id: string; name: string | null }; userId: string }
> {
  // 1. Validate the client + redirect_uri BEFORE any redirect (open-redirect guard).
  const client = params.clientId
    ? await prisma.oAuthClient.findUnique({
        where: { id: params.clientId },
        select: { id: true, name: true, redirectUris: true },
      })
    : null;
  if (!client) return { kind: 'response', res: errorPage('Неизвестный client_id.') };
  if (!client.redirectUris.includes(params.redirectUri)) {
    return { kind: 'response', res: errorPage('redirect_uri не совпадает с зарегистрированным.') };
  }

  // From here, protocol errors go back to the client via redirect.
  const fail = (error: string) => {
    const u = new URL(params.redirectUri);
    u.searchParams.set('error', error);
    if (params.state) u.searchParams.set('state', params.state);
    return NextResponse.redirect(u.toString(), { status: 302 });
  };
  if (params.responseType !== 'code') return { kind: 'response', res: fail('unsupported_response_type') };
  if (!params.codeChallenge || params.codeChallengeMethod !== 'S256') {
    return { kind: 'response', res: fail('invalid_request') };
  }

  // 2. Require a logged-in giper-pm user.
  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL('/login', baseUrl());
    login.searchParams.set('callbackUrl', selfUrlForLogin);
    return { kind: 'response', res: NextResponse.redirect(login.toString(), { status: 302 }) };
  }

  return { kind: 'ok', client: { id: client.id, name: client.name }, userId: session.user.id };
}

function bindingOf(params: AuthorizeParams, userId: string): ConsentBinding {
  return {
    userId,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: params.scope ?? '',
    state: params.state,
  };
}

/**
 * GET = render the consent screen. It never issues a code: approval is a POST.
 * (A bare `?approved=1` GET — the old auto-consent CSRF vector — does nothing
 * but re-render the consent form now.)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = readParams(url.searchParams);

  // This URL on the PUBLIC origin (req.url's host is the internal container
  // bind address behind nginx — never send the browser there).
  const selfUrl = `${baseUrl()}${url.pathname}${url.search}`;

  const v = await validate(params, selfUrl);
  if (v.kind === 'response') return v.res;

  const token = signConsentToken(bindingOf(params, v.userId));
  const appName = v.client.name ? escapeHtml(v.client.name) : 'Внешнее приложение';
  const action = `${baseUrl()}${url.pathname}`;
  const denyUrl = new URL(params.redirectUri);
  denyUrl.searchParams.set('error', 'access_denied');
  if (params.state) denyUrl.searchParams.set('state', params.state);

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <body style="font-family:system-ui;max-width:30rem;margin:4rem auto;padding:0 1rem;color:#111">
       <h2>Доступ к giper-pm</h2>
       <p><b>${appName}</b> запрашивает доступ к giper-pm от вашего имени
       (чтение и изменение задач в рамках ваших прав).</p>
       <form method="post" action="${escapeHtml(action)}" style="display:flex;gap:.75rem;margin-top:1.5rem;align-items:center">
         ${hidden('response_type', params.responseType)}
         ${hidden('client_id', params.clientId)}
         ${hidden('redirect_uri', params.redirectUri)}
         ${hidden('code_challenge', params.codeChallenge)}
         ${hidden('code_challenge_method', params.codeChallengeMethod)}
         ${hidden('state', params.state)}
         ${hidden('scope', params.scope ?? '')}
         ${hidden('consent_token', token)}
         <button type="submit"
            style="background:#111;color:#fff;padding:.6rem 1.2rem;border-radius:.5rem;border:0;cursor:pointer;font:inherit">Разрешить</button>
         <a href="${escapeHtml(denyUrl.toString())}"
            style="padding:.6rem 1.2rem;border-radius:.5rem;text-decoration:none;border:1px solid #ccc;color:#111">Отклонить</a>
       </form>
     </body>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** POST = consent approval. Validates the signed consent token, then issues a code. */
export async function POST(req: Request) {
  const url = new URL(req.url);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorPage('Некорректный запрос.');
  }
  const body = new URLSearchParams();
  for (const [k, val] of form.entries()) if (typeof val === 'string') body.set(k, val);
  const params = readParams(body);
  const consentToken = body.get('consent_token') ?? '';

  // Rebuild the GET consent URL so a login bounce returns to the screen, not POST.
  const consentUrl = new URL(`${baseUrl()}${url.pathname}`);
  consentUrl.searchParams.set('response_type', params.responseType);
  consentUrl.searchParams.set('client_id', params.clientId);
  consentUrl.searchParams.set('redirect_uri', params.redirectUri);
  consentUrl.searchParams.set('code_challenge', params.codeChallenge);
  consentUrl.searchParams.set('code_challenge_method', params.codeChallengeMethod);
  if (params.state) consentUrl.searchParams.set('state', params.state);
  if (params.scope) consentUrl.searchParams.set('scope', params.scope);

  const v = await validate(params, consentUrl.toString());
  if (v.kind === 'response') return v.res;

  // CSRF / tamper gate: the token must be ours, unexpired, and bound to THIS
  // user + these exact params.
  if (!verifyConsentToken(consentToken, bindingOf(params, v.userId))) {
    return errorPage('Сессия согласия истекла или недействительна. Повторите авторизацию.');
  }

  // Issue a single-use authorization code bound to the PKCE challenge.
  const code = randomToken('gpac_');
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: v.client.id,
      userId: v.userId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scope ?? undefined,
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    },
  });

  const back = new URL(params.redirectUri);
  back.searchParams.set('code', code);
  if (params.state) back.searchParams.set('state', params.state);
  return NextResponse.redirect(back.toString(), { status: 302 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
