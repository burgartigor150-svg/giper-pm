import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { randomToken, sha256, isAllowedRedirectUri } from '@/lib/oauth/core';

/**
 * RFC 7591 — Dynamic Client Registration. MCP clients (claude.ai) self-register
 * by posting their redirect_uris; we mint a client_id (+ optional secret). PKCE
 * is required at the token endpoint, so a public client (no secret) is fine.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: {
    redirect_uris?: unknown;
    client_name?: unknown;
    token_endpoint_auth_method?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  // Only https, or http for loopback (native clients). Plain http to a remote
  // host would let a code be exfiltrated over cleartext to an attacker server.
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && isAllowedRedirectUri(u))
    : [];
  if (redirectUris.length === 0) {
    return NextResponse.json(
      {
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris required (https, or http only for loopback)',
      },
      { status: 400 },
    );
  }

  const clientId = randomToken('gpc_');
  const isConfidential = body.token_endpoint_auth_method === 'client_secret_post';
  const secret = isConfidential ? randomToken('gps_') : null;

  await prisma.oAuthClient.create({
    data: {
      id: clientId,
      secretHash: secret ? sha256(secret) : null,
      name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null,
      redirectUris,
    },
  });

  return NextResponse.json(
    {
      client_id: clientId,
      ...(secret ? { client_secret: secret } : {}),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: isConfidential ? 'client_secret_post' : 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
