import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for per-kind in-app notification preferences:
 *   - createNotification must skip a kind the recipient has muted.
 *   - setNotificationPreferencesAction upserts the acting user's prefs.
 *
 * Source: apps/web/lib/notifications/createNotifications.ts
 *         apps/web/actions/notificationPrefs.ts
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

// Realtime push is fire-and-forget; stub it so tests don't need Redis/WS.
vi.mock('@giper/realtime/server', () => ({
  publishRealtime: vi.fn(async () => {}),
}));

import { prisma } from '@giper/db';
import { createNotification } from '@/lib/notifications/createNotifications';
import { setNotificationPreferencesAction } from '@/actions/notificationPrefs';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'MEMBER';
});

describe('createNotification — preference enforcement', () => {
  it('skips a kind the recipient has muted (inApp=false)', async () => {
    const user = await makeUser();
    await prisma.notificationPreference.create({
      data: { userId: user.id, kind: 'TASK_ASSIGNED', inApp: false },
    });

    const id = await createNotification({
      userId: user.id,
      kind: 'TASK_ASSIGNED',
      title: 'Назначена',
      link: '/projects/X/tasks/1',
    });

    expect(id).toBeNull();
    const count = await prisma.notification.count({
      where: { userId: user.id, kind: 'TASK_ASSIGNED' },
    });
    expect(count).toBe(0);
  });

  it('delivers a kind with no preference row (default on)', async () => {
    const user = await makeUser();
    const id = await createNotification({
      userId: user.id,
      kind: 'MENTION',
      title: 'Упомянули',
      link: '/projects/X/tasks/2',
    });
    expect(id).not.toBeNull();
  });

  it('delivers a kind explicitly enabled (inApp=true)', async () => {
    const user = await makeUser();
    await prisma.notificationPreference.create({
      data: { userId: user.id, kind: 'SYSTEM', inApp: true },
    });
    const id = await createNotification({ userId: user.id, kind: 'SYSTEM', title: 'Системное' });
    expect(id).not.toBeNull();
  });
});

describe('setNotificationPreferencesAction', () => {
  it('upserts the acting user\'s preferences', async () => {
    const user = await makeUser();
    mockMe.id = user.id;

    const res = await setNotificationPreferencesAction([
      { kind: 'TASK_ASSIGNED', inApp: false },
      { kind: 'MENTION', inApp: true },
    ]);
    expect(res.ok).toBe(true);

    const rows = await prisma.notificationPreference.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'TASK_ASSIGNED')?.inApp).toBe(false);

    // Re-saving the same kind updates (upsert), not duplicates.
    await setNotificationPreferencesAction([{ kind: 'TASK_ASSIGNED', inApp: true }]);
    const after = await prisma.notificationPreference.findUnique({
      where: { userId_kind: { userId: user.id, kind: 'TASK_ASSIGNED' } },
    });
    expect(after?.inApp).toBe(true);
  });

  it('rejects an unknown kind', async () => {
    const user = await makeUser();
    mockMe.id = user.id;
    const res = await setNotificationPreferencesAction([
      { kind: 'NOPE' as never, inApp: false },
    ]);
    expect(res.ok).toBe(false);
  });
});
