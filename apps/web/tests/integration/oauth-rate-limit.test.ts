import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verifies the rate-limit WIRING on the OAuth endpoints: when the limiter says
 * "over the limit" each route returns 429 + Retry-After (and the right body
 * shape per route), and when under the limit the request flows past the gate.
 *
 * The limiter itself (Redis fixed-window, fail-open) is mocked here so the test
 * is deterministic and needs no Redis. clientIp stays real.
 *
 * Source: apps/web/app/api/oauth/{token,register,authorize}/route.ts
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));

vi.mock('@/lib/api/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rateLimit')>();
  return { ...actual, rateLimit: vi.fn() };
});

import { rateLimit } from '@/lib/api/rateLimit';
import { POST as tokenRoute } from '@/app/api/oauth/token/route';
import { POST as registerRoute } from '@/app/api/oauth/register/route';
import { GET as authorizeGet, POST as authorizePost } from '@/app/api/oauth/authorize/route';

const mockRl = vi.mocked(rateLimit);

function form(body: string): Request {
  return new Request('http://test.local/x', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

beforeEach(() => {
  mockRl.mockReset();
});

describe('OAuth endpoints — rate limiting', () => {
  it('token: 429 + Retry-After (JSON) when limited', async () => {
    mockRl.mockResolvedValue({ ok: false, retryAfter: 7 });
    const res = await tokenRoute(form('grant_type=refresh_token'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
    expect(((await res.json()) as { error: string }).error).toBe('rate_limited');
  });

  it('register: 429 + Retry-After (JSON) when limited', async () => {
    mockRl.mockResolvedValue({ ok: false, retryAfter: 120 });
    const res = await registerRoute(
      new Request('http://test.local/api/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://app.example.com/cb'] }),
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    expect(((await res.json()) as { error: string }).error).toBe('rate_limited');
  });

  it('authorize GET + POST: 429 + Retry-After (text) when limited', async () => {
    mockRl.mockResolvedValue({ ok: false, retryAfter: 9 });
    const getRes = await authorizeGet(new Request('http://test.local/api/oauth/authorize?response_type=code'));
    expect(getRes.status).toBe(429);
    expect(getRes.headers.get('retry-after')).toBe('9');

    const postRes = await authorizePost(form('response_type=code'));
    expect(postRes.status).toBe(429);
    expect(postRes.headers.get('retry-after')).toBe('9');
  });

  it('passes the gate when under the limit (token reaches its own validation)', async () => {
    mockRl.mockResolvedValue({ ok: true });
    // No grant_type/client → the route proceeds PAST the limiter and fails its
    // own client check (401), proving the limiter did not short-circuit.
    const res = await tokenRoute(form(''));
    expect(res.status).not.toBe(429);
    expect(res.status).toBe(401);
  });
});
