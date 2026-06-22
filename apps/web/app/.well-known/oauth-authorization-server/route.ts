import { NextResponse } from 'next/server';
import { baseUrl } from '@/lib/oauth/core';

/** RFC 8414 — OAuth Authorization Server Metadata. Lets MCP clients discover
 *  the authorize/token/registration endpoints + PKCE support. */
export const dynamic = 'force-dynamic';

export function GET() {
  const base = baseUrl();
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['mcp'],
  });
}
