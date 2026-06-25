import type { PrismaClient } from '@giper/db';
import type { Bitrix24Client } from './client';

/**
 * Mirror each linked user's Bitrix24 personal calendar into CalendarEvent
 * (read-only, one-way). `calendar.event.get` (type=user) returns the events the
 * user owns or is invited to — meetings/events from the B24 "Calendar" module
 * that aren't tasks. Dedup is per-(user,event) so a shared event mirrors once
 * per attendee; each user sees their own B24 calendar inside giper-pm.
 *
 * The giper calendar page already queries CalendarEvent (where createdById=me OR
 * attendee=me), so mirrored events show up with no read-side changes.
 */

const SOURCE = 'bitrix24';
const MAX_EVENTS_PER_USER = 1000;

export type SyncBitrixCalendarResult = {
  users: number;
  events: number;
  deleted: number;
  errors: string[];
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a Bitrix24 calendar date. Handles ISO (`2026-06-26T09:00:00+03:00`) and
 * the legacy portal format (`DD.MM.YYYY` / `DD.MM.YYYY HH:mm:ss`). Returns null
 * when unparseable so the event is skipped rather than stored with a bad date.
 */
export function parseBitrixDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export async function syncBitrixCalendar(
  prisma: PrismaClient,
  client: Pick<Bitrix24Client, 'call'>,
  opts: { daysBack?: number; daysForward?: number; signal?: AbortSignal } = {},
): Promise<SyncBitrixCalendarResult> {
  const daysBack = opts.daysBack ?? 14;
  const daysForward = opts.daysForward ?? 120;
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 86400_000);
  const to = new Date(now.getTime() + daysForward * 86400_000);

  const errors: string[] = [];
  let events = 0;
  let deleted = 0;

  // Only real giper users (active, linked to a B24 account) — non-login
  // bitrix-only people would never look at the giper calendar.
  const users = await prisma.user.findMany({
    where: { isActive: true, bitrixUserId: { not: null } },
    select: { id: true, bitrixUserId: true },
  });

  for (const u of users) {
    if (opts.signal?.aborted) break;
    if (!u.bitrixUserId) continue;

    let result: unknown;
    try {
      const res = await client.call<unknown>('calendar.event.get', {
        type: 'user',
        ownerId: u.bitrixUserId,
        from: ymd(from),
        to: ymd(to),
      });
      result = (res as { result?: unknown }).result;
    } catch (e) {
      errors.push(`user ${u.bitrixUserId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const list = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
    const seen = new Set<string>();
    for (const ev of list.slice(0, MAX_EVENTS_PER_USER)) {
      const evId = ev.ID != null ? String(ev.ID) : null;
      if (!evId) continue;
      const startAt = parseBitrixDate(ev.DATE_FROM);
      const endAt =
        parseBitrixDate(ev.DATE_TO) ?? (startAt ? new Date(startAt.getTime() + 3600_000) : null);
      if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
        errors.push(`event ${evId}: unparseable/invalid dates`);
        continue;
      }
      const externalId = `bxcal:${u.bitrixUserId}:${evId}`;
      seen.add(externalId);
      const title =
        (typeof ev.NAME === 'string' && ev.NAME.trim()) || 'Событие Bitrix24';
      const isAllDay = ev.SKIP_TIME === 'Y' || ev.SKIP_TIME === true;
      const description =
        typeof ev.DESCRIPTION === 'string' && ev.DESCRIPTION.trim()
          ? ev.DESCRIPTION.slice(0, 5000)
          : null;
      const location =
        typeof ev.LOCATION === 'string' && ev.LOCATION.trim() ? ev.LOCATION.slice(0, 500) : null;
      try {
        await prisma.calendarEvent.upsert({
          where: { externalSource_externalId: { externalSource: SOURCE, externalId } },
          create: {
            title,
            description,
            startAt,
            endAt,
            isAllDay,
            location,
            createdById: u.id,
            externalSource: SOURCE,
            externalId,
          },
          update: { title, description, startAt, endAt, isAllDay, location },
        });
        events++;
      } catch (e) {
        errors.push(`event ${evId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Reconcile: drop this user's mirrored events inside the window that B24 no
    // longer returns (deleted/moved upstream).
    try {
      const local = await prisma.calendarEvent.findMany({
        where: {
          externalSource: SOURCE,
          createdById: u.id,
          externalId: { startsWith: `bxcal:${u.bitrixUserId}:` },
          // Overlap with the queried window (matches calendar.event.get, which
          // returns events overlapping [from,to) — including ones that started
          // before `from`), so a past-spanning event removed upstream is still
          // reconciled instead of orphaning forever.
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { id: true, externalId: true },
      });
      const stale = local.filter((e) => e.externalId && !seen.has(e.externalId)).map((e) => e.id);
      if (stale.length) {
        await prisma.calendarEvent.deleteMany({ where: { id: { in: stale } } });
        deleted += stale.length;
      }
    } catch (e) {
      errors.push(`reconcile ${u.bitrixUserId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { users: users.length, events, deleted, errors: errors.slice(0, 50) };
}
