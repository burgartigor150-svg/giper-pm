import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@giper/db';
import { syncBitrixCalendar, parseBitrixDate } from '@giper/integrations/bitrix24';

/**
 * Integration tests for the Bitrix24 personal-calendar mirror (read-only). A
 * stub client returns calendar.event.get payloads; assert events become
 * CalendarEvent rows, the sync is idempotent, and upstream-removed events are
 * reconciled away. Source: packages/integrations/src/bitrix24/syncCalendar.ts.
 */

function stubClient(eventsByUser: Record<string, Array<Record<string, unknown>>>) {
  let calls = 0;
  return {
    call: async (_method: string, params: Record<string, unknown>) => {
      calls++;
      const owner = String(params.ownerId);
      return { result: eventsByUser[owner] ?? [] } as { result: unknown };
    },
    calls: () => calls,
  };
}

async function makeBitrixUser(bitrixUserId: string) {
  return prisma.user.create({
    data: {
      email: `b24-${bitrixUserId}-${Date.now()}@test.local`,
      name: `B24 ${bitrixUserId}`,
      role: 'MEMBER',
      isActive: true,
      passwordHash: 'x',
      bitrixUserId,
    },
  });
}

beforeEach(async () => {
  await prisma.calendarEvent.deleteMany({});
});

describe('parseBitrixDate', () => {
  it('parses ISO with offset', () => {
    expect(parseBitrixDate('2026-06-26T09:00:00+03:00')?.toISOString()).toBe('2026-06-26T06:00:00.000Z');
  });
  it('parses legacy DD.MM.YYYY HH:mm:ss', () => {
    const d = parseBitrixDate('26.06.2026 09:30:00');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5); // June
    expect(d?.getDate()).toBe(26);
  });
  it('parses date-only DD.MM.YYYY', () => {
    expect(parseBitrixDate('26.06.2026')?.getDate()).toBe(26);
  });
  it('returns null for junk / empty', () => {
    expect(parseBitrixDate('не дата')).toBeNull();
    expect(parseBitrixDate('')).toBeNull();
    expect(parseBitrixDate(null)).toBeNull();
  });
});

describe('syncBitrixCalendar', () => {
  it('mirrors a user’s B24 calendar events into CalendarEvent', async () => {
    const u = await makeBitrixUser('501');
    const client = stubClient({
      '501': [
        {
          ID: '900',
          NAME: 'Планёрка',
          DATE_FROM: '2026-06-26T09:00:00+00:00',
          DATE_TO: '2026-06-26T10:00:00+00:00',
          SKIP_TIME: 'N',
          LOCATION: 'Zoom',
        },
        { ID: '901', NAME: 'Отпуск', DATE_FROM: '26.06.2026', DATE_TO: '27.06.2026', SKIP_TIME: 'Y' },
      ],
    });

    const res = await syncBitrixCalendar(prisma, client);
    expect(res.events).toBe(2);

    const rows = await prisma.calendarEvent.findMany({
      where: { createdById: u.id, externalSource: 'bitrix24' },
      orderBy: { externalId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.externalId).toBe('bxcal:501:900');
    expect(rows[0]?.title).toBe('Планёрка');
    expect(rows[0]?.location).toBe('Zoom');
    expect(rows[0]?.isAllDay).toBe(false);
    expect(rows[1]?.isAllDay).toBe(true);
  });

  it('is idempotent — a re-sync upserts in place, no duplicates', async () => {
    const u = await makeBitrixUser('502');
    const client = stubClient({
      '502': [{ ID: '1', NAME: 'A', DATE_FROM: '2026-06-26T09:00:00+00:00', DATE_TO: '2026-06-26T10:00:00+00:00' }],
    });
    await syncBitrixCalendar(prisma, client);
    await syncBitrixCalendar(prisma, client);
    expect(await prisma.calendarEvent.count({ where: { createdById: u.id } })).toBe(1);
  });

  it('reconciles: an event removed upstream is deleted on the next sync', async () => {
    const u = await makeBitrixUser('503');
    const two = stubClient({
      '503': [
        { ID: '1', NAME: 'Keep', DATE_FROM: '2026-06-26T09:00:00+00:00', DATE_TO: '2026-06-26T10:00:00+00:00' },
        { ID: '2', NAME: 'Drop', DATE_FROM: '2026-06-26T11:00:00+00:00', DATE_TO: '2026-06-26T12:00:00+00:00' },
      ],
    });
    await syncBitrixCalendar(prisma, two);
    expect(await prisma.calendarEvent.count({ where: { createdById: u.id } })).toBe(2);

    const one = stubClient({
      '503': [{ ID: '1', NAME: 'Keep', DATE_FROM: '2026-06-26T09:00:00+00:00', DATE_TO: '2026-06-26T10:00:00+00:00' }],
    });
    const res = await syncBitrixCalendar(prisma, one);
    expect(res.deleted).toBe(1);
    const rows = await prisma.calendarEvent.findMany({ where: { createdById: u.id } });
    expect(rows.map((r) => r.externalId)).toEqual(['bxcal:503:1']);
  });

  it('skips events with unparseable dates without aborting the rest', async () => {
    const u = await makeBitrixUser('504');
    const client = stubClient({
      '504': [
        { ID: '1', NAME: 'Bad', DATE_FROM: 'не дата', DATE_TO: 'не дата' },
        { ID: '2', NAME: 'Good', DATE_FROM: '2026-06-26T09:00:00+00:00', DATE_TO: '2026-06-26T10:00:00+00:00' },
      ],
    });
    const res = await syncBitrixCalendar(prisma, client);
    expect(res.events).toBe(1);
    expect(res.errors.length).toBe(1);
    expect(await prisma.calendarEvent.count({ where: { createdById: u.id } })).toBe(1);
  });
});
