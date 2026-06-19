import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the public REST API:
 *   - createApiTokenAction / revokeApiTokenAction.
 *   - resolveApiToken (valid / unknown / revoked / inactive).
 *   - GET /api/public/v1/projects (Bearer auth, scoped to the token owner).
 *
 * Source: apps/web/lib/api/*, apps/web/actions/apiTokens.ts,
 *         apps/web/app/api/public/v1/projects/route.ts
 */

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { createApiTokenAction, revokeApiTokenAction } from '@/actions/apiTokens';
import { GET as listProjects } from '@/app/api/public/v1/projects/route';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'MEMBER';
});

function bearer(token: string): Request {
  return new Request('http://test.local/api/public/v1/projects', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('createApiTokenAction + resolveApiToken', () => {
  it('issues a usable token that resolves to its owner', async () => {
    const user = await makeUser();
    mockMe.id = user.id;

    const created = await createApiTokenAction('CI бот');
    expect(created.ok).toBe(true);
    const raw = created.ok ? created.data!.token : '';
    expect(raw).toMatch(/^gpm_[0-9a-f]{48}$/);

    const resolved = await resolveApiToken(bearer(raw));
    expect(resolved?.id).toBe(user.id);
  });

  it('rejects unknown, malformed, and revoked tokens', async () => {
    const user = await makeUser();
    mockMe.id = user.id;

    expect(await resolveApiToken(bearer('gpm_deadbeef'))).toBeNull();
    expect(await resolveApiToken(new Request('http://t.local'))).toBeNull(); // no header

    const created = await createApiTokenAction('Tmp');
    const raw = created.ok ? created.data!.token : '';
    const tok = await prisma.apiToken.findFirstOrThrow({ where: { userId: user.id } });
    await revokeApiTokenAction(tok.id);
    expect(await resolveApiToken(bearer(raw))).toBeNull();
  });

  it('rejects a token whose owner is inactive', async () => {
    const user = await makeUser();
    mockMe.id = user.id;
    const created = await createApiTokenAction('X');
    const raw = created.ok ? created.data!.token : '';
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await resolveApiToken(bearer(raw))).toBeNull();
  });
});

describe('GET /api/public/v1/projects', () => {
  it('returns 401 without a token', async () => {
    const res = await listProjects(new Request('http://test.local/api/public/v1/projects'));
    expect(res.status).toBe(401);
  });

  it('returns the token owner\'s visible projects', async () => {
    const user = await makeUser();
    mockMe.id = user.id;
    const project = await makeProject({ ownerId: user.id });
    // listProjectsForUser scope 'mine' = visibility via task stake (or Bitrix
    // membership), so give the user a stake to make the project visible —
    // same rule the in-app project list uses.
    await makeTask({ projectId: project.id, creatorId: user.id });
    const created = await createApiTokenAction('Read');
    const raw = created.ok ? created.data!.token : '';

    const res = await listProjects(bearer(raw));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { key: string }[] };
    expect(body.ok).toBe(true);
    expect(body.data.some((p) => p.key === project.key)).toBe(true);
  });
});
