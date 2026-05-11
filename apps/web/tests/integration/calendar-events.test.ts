import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from '@giper/db';
import {
  createCalendarEventAction,
  listCalendarEventsAction,
  deleteCalendarEventAction,
} from '@/actions/calendar';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

describe('createCalendarEventAction', () => {
  it('happy path: creator becomes auto-attendee', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const r = await createCalendarEventAction({
      title: 'Планёрка',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    const attendees = await prisma.calendarEventAttendee.findMany({
      where: { eventId: r.data.id },
    });
    expect(attendees.map((a) => a.userId)).toContain(u.id);
  });

  it('rejects empty title', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const r = await createCalendarEventAction({
      title: '   ',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects end <= start', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const r = await createCalendarEventAction({
      title: 'Bad',
      startAt: '2026-05-12T10:00:00.000Z',
      endAt: '2026-05-12T09:00:00.000Z',
    });
    expect(r.ok).toBe(false);
  });

  it('extra attendees get linked', async () => {
    const u = await makeUser();
    const other = await makeUser();
    mockMe.id = u.id;
    const r = await createCalendarEventAction({
      title: 'Встреча с коллегой',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
      attendeeIds: [other.id],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    const attendees = await prisma.calendarEventAttendee.findMany({
      where: { eventId: r.data.id },
    });
    const ids = attendees.map((a) => a.userId).sort();
    expect(ids).toContain(u.id);
    expect(ids).toContain(other.id);
  });
});

describe('listCalendarEventsAction', () => {
  it('returns events overlapping the range for the caller', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    await createCalendarEventAction({
      title: 'Май',
      startAt: '2026-05-15T09:00:00.000Z',
      endAt: '2026-05-15T10:00:00.000Z',
    });
    await createCalendarEventAction({
      title: 'Июнь',
      startAt: '2026-06-15T09:00:00.000Z',
      endAt: '2026-06-15T10:00:00.000Z',
    });
    const r = await listCalendarEventsAction(
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.data.map((e) => e.title);
    expect(titles).toContain('Май');
    expect(titles).not.toContain('Июнь');
  });

  it('does not leak other users events', async () => {
    const u = await makeUser();
    const other = await makeUser();
    mockMe.id = other.id;
    await createCalendarEventAction({
      title: 'Чужое',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
    });
    mockMe.id = u.id;
    const r = await listCalendarEventsAction(
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.find((e) => e.title === 'Чужое')).toBeUndefined();
  });

  it('attendee can see an event they did not create', async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    mockMe.id = creator.id;
    await createCalendarEventAction({
      title: 'Общее',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
      attendeeIds: [guest.id],
    });
    mockMe.id = guest.id;
    const r = await listCalendarEventsAction(
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.find((e) => e.title === 'Общее')).toBeDefined();
  });
});

describe('deleteCalendarEventAction', () => {
  it('creator can delete', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const c = await createCalendarEventAction({
      title: 'Tmp',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
    });
    if (!c.ok || !c.data) throw new Error('setup');
    const r = await deleteCalendarEventAction(c.data.id);
    expect(r.ok).toBe(true);
    const after = await prisma.calendarEvent.findUnique({ where: { id: c.data.id } });
    expect(after).toBeNull();
  });

  it('non-creator attendee cannot delete', async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    mockMe.id = creator.id;
    const c = await createCalendarEventAction({
      title: 'Shared',
      startAt: '2026-05-12T09:00:00.000Z',
      endAt: '2026-05-12T10:00:00.000Z',
      attendeeIds: [guest.id],
    });
    if (!c.ok || !c.data) throw new Error('setup');
    mockMe.id = guest.id;
    const r = await deleteCalendarEventAction(c.data.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('NOT_FOUND on unknown id', async () => {
    const u = await makeUser();
    mockMe.id = u.id;
    const r = await deleteCalendarEventAction('does-not-exist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});
