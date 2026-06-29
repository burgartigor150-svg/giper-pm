import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the OAuth token endpoint's refresh_token grant —
 * specifically the atomic rotation fix: the OLD refresh token must be
 * invalidated by a successful rotation, and a failed/duplicate rotation must
 * never leave the old token usable (no token reuse).
 *
 * Source: apps/web/app/api/oauth/token/route.ts, apps/web/lib/oauth/core.ts
 */

import { prisma } from '@giper/db';
import { sha256 } from '@/lib/oauth/core';
import { POST as tokenRoute } from '@/app/api/oauth/token/route';
import { makeUser } from './helpers/factories';

let clientSeq = 0;

async function makeClient() {
  return prisma.oAuthClient.create({
    data: {
      id: `gpc_test_${Date.now()}_${clientSeq++}`,
      secretHash: null, // public client — PKCE/possession is the proof
      name: 'Test client',
      redirectUris: ['https://app.example.com/cb'],
    },
  });
}

async function seedRefreshToken(clientId: string, userId: string, opts: { expiresAt?: Date } = {}) {
  const raw = `gpr_${sha256(`${clientId}:${userId}:${Date.now()}:${Math.random()}`)}`;
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: sha256(raw),
      clientId,
      userId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000 * 60),
    },
  });
  return raw;
}

let ipSeq = 0;

function refreshReq(params: Record<string, string>): Request {
  // Unique per-request IP so the (real) per-IP rate limiter never accumulates
  // a shared bucket across these calls / repeated local runs.
  return new Request('http://test.local/api/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': `10.9.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`,
    },
    body: new URLSearchParams(params).toString(),
  });
}

describe('OAuth token endpoint — refresh_token rotation', () => {
  it('rotates the token and invalidates the old one (no reuse)', async () => {
    const user = await makeUser();
    const client = await makeClient();
    const oldRaw = await seedRefreshToken(client.id, user.id);

    const res = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: client.id, refresh_token: oldRaw }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).toMatch(/^gpo_/);
    expect(body.refresh_token).toMatch(/^gpr_/);
    expect(body.refresh_token).not.toBe(oldRaw);

    // Old refresh row is gone; the new one exists.
    expect(
      await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(oldRaw) } }),
    ).toBeNull();
    expect(
      await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(body.refresh_token) } }),
    ).not.toBeNull();
    // A fresh access token was issued.
    expect(
      await prisma.oAuthAccessToken.findUnique({ where: { tokenHash: sha256(body.access_token) } }),
    ).not.toBeNull();
  });

  it('rejects reuse of an already-rotated refresh token', async () => {
    const user = await makeUser();
    const client = await makeClient();
    const oldRaw = await seedRefreshToken(client.id, user.id);

    const first = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: client.id, refresh_token: oldRaw }),
    );
    expect(first.status).toBe(200);
    const { refresh_token: newRaw } = (await first.json()) as { refresh_token: string };

    // Replaying the OLD token must fail — the rotation deleted it.
    const replay = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: client.id, refresh_token: oldRaw }),
    );
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');

    // The NEW token still works (chain continues).
    const chained = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: client.id, refresh_token: newRaw }),
    );
    expect(chained.status).toBe(200);
  });

  it('rejects an expired refresh token without issuing or deleting anything', async () => {
    const user = await makeUser();
    const client = await makeClient();
    const expiredRaw = await seedRefreshToken(client.id, user.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: client.id, refresh_token: expiredRaw }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    // The (expired) row is untouched — not consumed as a side effect.
    expect(
      await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(expiredRaw) } }),
    ).not.toBeNull();
  });

  it('rejects a refresh token presented under a different client_id', async () => {
    const user = await makeUser();
    const clientA = await makeClient();
    const clientB = await makeClient();
    const raw = await seedRefreshToken(clientA.id, user.id);

    const res = await tokenRoute(
      refreshReq({ grant_type: 'refresh_token', client_id: clientB.id, refresh_token: raw }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    // Token A is still intact (a wrong-client probe must not delete it).
    expect(
      await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(raw) } }),
    ).not.toBeNull();
  });
});
