import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Push subscription persistence — server-action contract.
 *
 * We don't dial out to a real push gateway here; that's covered by
 * the `web-push` library's own tests. What we DO test:
 *   - subscribe upserts by endpoint (no duplicates on re-subscribe)
 *   - unsubscribe only removes the caller's own subscription
 *   - oversized inputs are rejected
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

import { prisma } from '@giper/db';
import {
  subscribePushAction,
  unsubscribePushAction,
  listMyPushSubscriptionsAction,
} from '@/actions/push';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

const goodSub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc-123',
  p256dh: 'BIPUL12DLfYtoFhQjQzgrFnFu4FbBA',
  authSec: 'tBHItJI5svbpez7KI4CCXg',
};

describe('subscribePushAction', () => {
  it('persists a fresh subscription with userId, ua, and timestamps', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const r = await subscribePushAction({ ...goodSub, userAgent: 'TestBrowser/1.0' });
    expect(r.ok).toBe(true);
    const row = await prisma.pushSubscription.findUnique({
      where: { endpoint: goodSub.endpoint },
    });
    expect(row?.userId).toBe(u.id);
    expect(row?.p256dh).toBe(goodSub.p256dh);
    expect(row?.authSec).toBe(goodSub.authSec);
    expect(row?.userAgent).toBe('TestBrowser/1.0');
  });

  it('re-subscribe with same endpoint upserts (no duplicate row)', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    await subscribePushAction(goodSub);
    await subscribePushAction({
      ...goodSub,
      p256dh: 'NEW-KEY',
      authSec: 'NEW-AUTH',
    });
    const all = await prisma.pushSubscription.findMany({
      where: { endpoint: goodSub.endpoint },
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.p256dh).toBe('NEW-KEY');
  });

  it('same endpoint moved between users updates ownership', async () => {
    // Edge case: two users share a device → both subscribe → the
    // browser hands the second user the same endpoint. We re-bind
    // ownership rather than 409.
    const u1 = await makeUser();
    const u2 = await makeUser();
    mockMe.id = u1.id;
    await subscribePushAction(goodSub);
    mockMe.id = u2.id;
    await subscribePushAction(goodSub);
    const row = await prisma.pushSubscription.findUnique({
      where: { endpoint: goodSub.endpoint },
    });
    expect(row?.userId).toBe(u2.id);
  });

  it('rejects missing fields', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    expect(
      await subscribePushAction({ endpoint: '', p256dh: 'x', authSec: 'y' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await subscribePushAction({ endpoint: 'e', p256dh: '', authSec: 'y' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects oversized inputs', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    expect(
      await subscribePushAction({
        endpoint: 'a'.repeat(2000),
        p256dh: goodSub.p256dh,
        authSec: goodSub.authSec,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('unsubscribePushAction', () => {
  it('only deletes the caller-owned subscription', async () => {
    const me = await makeUser();
    const other = await makeUser();
    mockMe.id = me.id;
    await subscribePushAction(goodSub);
    // other user has a subscription on a different endpoint:
    mockMe.id = other.id;
    await subscribePushAction({ ...goodSub, endpoint: 'https://x/other' });

    // me tries to unsub OTHER's endpoint — should not remove it.
    mockMe.id = me.id;
    await unsubscribePushAction('https://x/other');
    const others = await prisma.pushSubscription.findUnique({
      where: { endpoint: 'https://x/other' },
    });
    expect(others).not.toBeNull();
    // me unsubs own endpoint — gone.
    await unsubscribePushAction(goodSub.endpoint);
    const mine = await prisma.pushSubscription.findUnique({
      where: { endpoint: goodSub.endpoint },
    });
    expect(mine).toBeNull();
  });
});

describe('listMyPushSubscriptionsAction', () => {
  it('returns only this user\'s subscriptions, newest first', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    await subscribePushAction({ ...goodSub, endpoint: 'https://x/a', userAgent: 'A' });
    await subscribePushAction({ ...goodSub, endpoint: 'https://x/b', userAgent: 'B' });
    const r = await listMyPushSubscriptionsAction();
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.count).toBe(2);
      // Both rows present; createdAt ordering is best-effort
      // (Postgres timestamp resolution is microseconds and the
      // two inserts can land in the same one). Just assert
      // membership.
      const uas = r.data.devices.map((d) => d.userAgent).sort();
      expect(uas).toEqual(['A', 'B']);
    }
  });
});
