import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { auth } from '@/lib/auth';
import { randomToken, sha256, CODE_TTL_SEC, baseUrl } from '@/lib/oauth/core';

/**
 * OAuth Authorization Endpoint (Authorization Code + PKCE).
 *
 * Login reuses the giper-pm session: this route is NOT in the middleware
 * public allowlist, so an unauthenticated browser is bounced to /login and
 * returns here afterwards. We then show a consent screen; on approval we mint
 * a single-use code bound to the PKCE challenge and redirect back to the client.
 */
export const dynamic = 'force-dynamic';

function errorPage(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
     <h2>Ошибка авторизации</h2><p>${message}</p></body>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const responseType = q.get('response_type');
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const codeChallenge = q.get('code_challenge') ?? '';
  const codeChallengeMethod = q.get('code_challenge_method') ?? '';
  const state = q.get('state') ?? '';
  const scope = q.get('scope');
  const approved = q.get('approved') === '1';

  // 1. Validate the client + redirect_uri BEFORE any redirect (open-redirect guard).
  const client = clientId
    ? await prisma.oAuthClient.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, redirectUris: true },
      })
    : null;
  if (!client) return errorPage('Неизвестный client_id.');
  if (!client.redirectUris.includes(redirectUri)) {
    return errorPage('redirect_uri не совпадает с зарегистрированным.');
  }

  // From here, protocol errors go back to the client via redirect.
  const fail = (error: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    if (state) u.searchParams.set('state', state);
    return NextResponse.redirect(u.toString(), { status: 302 });
  };
  if (responseType !== 'code') return fail('unsupported_response_type');
  if (!codeChallenge || codeChallengeMethod !== 'S256') return fail('invalid_request');

  // This URL on the PUBLIC origin (req.url's host is the internal container
  // bind address behind nginx — never send the browser there).
  const selfUrl = `${baseUrl()}${url.pathname}${url.search}`;

  // 2. Require a logged-in giper-pm user.
  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL('/login', baseUrl());
    login.searchParams.set('callbackUrl', selfUrl);
    return NextResponse.redirect(login.toString(), { status: 302 });
  }

  // 3. Consent screen (unless already approved=1).
  if (!approved) {
    const approveUrl = new URL(selfUrl);
    approveUrl.searchParams.set('approved', '1');
    const denyUrl = new URL(redirectUri);
    denyUrl.searchParams.set('error', 'access_denied');
    if (state) denyUrl.searchParams.set('state', state);
    const appName = client.name ? escapeHtml(client.name) : 'Внешнее приложение';
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <body style="font-family:system-ui;max-width:30rem;margin:4rem auto;padding:0 1rem;color:#111">
         <h2>Доступ к giper-pm</h2>
         <p><b>${appName}</b> запрашивает доступ к giper-pm от вашего имени
         (чтение и изменение задач в рамках ваших прав).</p>
         <div style="display:flex;gap:.75rem;margin-top:1.5rem">
           <a href="${escapeHtml(approveUrl.toString())}"
              style="background:#111;color:#fff;padding:.6rem 1.2rem;border-radius:.5rem;text-decoration:none">Разрешить</a>
           <a href="${escapeHtml(denyUrl.toString())}"
              style="padding:.6rem 1.2rem;border-radius:.5rem;text-decoration:none;border:1px solid #ccc;color:#111">Отклонить</a>
         </div>
       </body>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  // 4. Issue a single-use authorization code bound to the PKCE challenge.
  const code = randomToken('gpac_');
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: client.id,
      userId: session.user.id,
      redirectUri,
      codeChallenge,
      scope: scope ?? undefined,
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    },
  });

  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  if (state) back.searchParams.set('state', state);
  return NextResponse.redirect(back.toString(), { status: 302 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
