import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import {
  sha256,
  verifyPkceS256,
  issueTokens,
  randomToken,
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
} from '@/lib/oauth/core';

/**
 * OAuth Token Endpoint. Supports authorization_code (with PKCE) and
 * refresh_token grants. Public clients (PKCE, no secret) and confidential
 * clients (client_secret_post) are both accepted.
 */
export const dynamic = 'force-dynamic';

function bad(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status },
  );
}

async function readParams(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get('content-type') ?? '';
  const text = await req.text();
  if (ct.includes('application/json')) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(o)) if (v != null) p.set(k, String(v));
      return p;
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

/** Confirm the client exists and, if confidential, the secret matches. */
async function authClient(clientId: string, clientSecret: string | null): Promise<boolean> {
  if (!clientId) return false;
  const client = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { secretHash: true },
  });
  if (!client) return false;
  if (client.secretHash) {
    return !!clientSecret && sha256(clientSecret) === client.secretHash;
  }
  return true; // public client — PKCE is the proof
}

export async function POST(req: Request) {
  const p = await readParams(req);
  const grantType = p.get('grant_type') ?? '';
  const clientId = p.get('client_id') ?? '';
  const clientSecret = p.get('client_secret');

  if (!(await authClient(clientId, clientSecret))) {
    return bad('invalid_client', 'Неизвестный client_id или неверный секрет', 401);
  }

  if (grantType === 'authorization_code') {
    const code = p.get('code') ?? '';
    const redirectUri = p.get('redirect_uri') ?? '';
    const verifier = p.get('code_verifier') ?? '';
    if (!code || !verifier) return bad('invalid_request', 'code и code_verifier обязательны');

    const row = await prisma.oAuthAuthCode.findUnique({
      where: { codeHash: sha256(code) },
      select: {
        id: true,
        clientId: true,
        userId: true,
        redirectUri: true,
        codeChallenge: true,
        scope: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return bad('invalid_grant', 'Код недействителен или истёк');
    }
    if (row.clientId !== clientId || row.redirectUri !== redirectUri) {
      return bad('invalid_grant', 'Несовпадение client_id/redirect_uri');
    }
    if (!verifyPkceS256(verifier, row.codeChallenge)) {
      return bad('invalid_grant', 'PKCE проверка не пройдена');
    }

    // Single-use: consume the code first (idempotent guard via updateMany).
    const consumed = await prisma.oAuthAuthCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) return bad('invalid_grant', 'Код уже использован');

    const { accessToken, refreshToken, expiresIn } = await issueTokens(
      row.clientId,
      row.userId,
      row.scope,
    );
    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: row.scope ?? 'mcp',
    });
  }

  if (grantType === 'refresh_token') {
    const refresh = p.get('refresh_token') ?? '';
    if (!refresh) return bad('invalid_request', 'refresh_token обязателен');
    const row = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: sha256(refresh) },
      select: { id: true, clientId: true, userId: true, expiresAt: true },
    });
    if (!row || row.clientId !== clientId || row.expiresAt.getTime() < Date.now()) {
      return bad('invalid_grant', 'refresh_token недействителен');
    }
    // Issue a fresh access token; rotate the refresh token and drop the old.
    const accessToken = randomToken('gpo_');
    const newRefresh = randomToken('gpr_');
    const now = Date.now();
    await prisma.oAuthAccessToken.create({
      data: {
        tokenHash: sha256(accessToken),
        clientId: row.clientId,
        userId: row.userId,
        expiresAt: new Date(now + ACCESS_TTL_SEC * 1000),
      },
    });
    await prisma.oAuthRefreshToken.create({
      data: {
        tokenHash: sha256(newRefresh),
        clientId: row.clientId,
        userId: row.userId,
        expiresAt: new Date(now + REFRESH_TTL_SEC * 1000),
      },
    });
    await prisma.oAuthRefreshToken.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SEC,
      refresh_token: newRefresh,
      scope: 'mcp',
    });
  }

  return bad('unsupported_grant_type');
}
