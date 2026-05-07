import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { createNotification } from '@/lib/notifications/createNotifications';

/**
 * Hourly overdue scanner. Finds open tasks past their dueDate that
 * haven't been pinged in the last 24h, pings the assignee/reviewer/
 * creator, records the ping in payload to dedupe future runs.
 *
 * Auth: shared CRON_SECRET in the Authorization header. Same pattern
 * as /api/cron/bitrix24.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

const OVERDUE_GRACE_HOURS = 24;

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const since = new Date(now.getTime() - OVERDUE_GRACE_HOURS * 3600_000);

  // Open tasks past their deadline.
  const overdue = await prisma.task.findMany({
    where: {
      dueDate: { lt: now },
      internalStatus: { notIn: ['DONE', 'CANCELED'] },
    },
    select: {
      id: true,
      number: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      reviewerId: true,
      creatorId: true,
      project: { select: { key: true, name: true } },
    },
    take: 500, // safety cap; if there are more, next run picks them up
  });

  let pinged = 0;
  for (const t of overdue) {
    // Recipients: assignee + creator + reviewer (deduped, no nulls).
    const recipients = new Set<string>();
    if (t.assigneeId) recipients.add(t.assigneeId);
    if (t.reviewerId) recipients.add(t.reviewerId);
    recipients.add(t.creatorId);

    for (const userId of recipients) {
      // Did we already ping this user about THIS task in the last 24h?
      const recent = await prisma.notification.findFirst({
        where: {
          userId,
          kind: 'DEADLINE_PASSED',
          link: `/projects/${t.project.key}/tasks/${t.number}`,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (recent) continue;
      const id = await createNotification(
        {
          userId,
          kind: 'DEADLINE_PASSED',
          title: `Просрочена: «${t.title}» (${t.project.key})`,
          body: t.dueDate
            ? `Дедлайн был ${new Intl.DateTimeFormat('ru-RU').format(t.dueDate)}`
            : null,
          link: `/projects/${t.project.key}/tasks/${t.number}`,
          payload: { taskId: t.id, projectKey: t.project.key, taskNumber: t.number },
        },
        { dedupe: false }, // we already deduped above on a 24h window
      );
      if (id) pinged++;
    }
  }

  return NextResponse.json({ ok: true, scanned: overdue.length, pinged });
}
