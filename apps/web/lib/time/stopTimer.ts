import { prisma } from '@giper/db';

/**
 * Closes the user's currently-running timer, if any. No-op when nothing
 * is running — safer against double-clicks from multiple tabs.
 */
export async function stopTimer(userId: string, note?: string) {
  const active = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null, source: 'MANUAL_TIMER' },
    select: { id: true, startedAt: true, note: true },
  });
  if (!active) return null;

  const endedAt = new Date();
  // Round so accidental Start→Stop clicks don't write zero-minute entries.
  const durationMin = Math.max(
    1,
    Math.round((endedAt.getTime() - active.startedAt.getTime()) / 60_000),
  );

  return prisma.timeEntry.update({
    where: { id: active.id },
    data: {
      endedAt,
      durationMin,
      // Append note to existing one if both present.
      ...(note
        ? { note: active.note ? `${active.note}\n${note}` : note }
        : {}),
    },
    select: { id: true, durationMin: true, endedAt: true },
  });
}
