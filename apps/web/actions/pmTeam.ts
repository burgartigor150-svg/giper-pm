'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import type { TeamMemberRow } from '@/lib/teams/types';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * PM curates a private "my team" roster. Members may sit in multiple
 * PMs' rosters — that's the whole point of the feature, shared people.
 *
 * Permission: only ADMIN or PM (themselves) can write to this list.
 * A PM may only manage their own roster — they can't reach into
 * another PM's roster.
 */
export async function addToPmTeamAction(
  memberId: string,
  note?: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только PM/ADMIN' },
    };
  }
  if (memberId === me.id) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нельзя добавить себя' } };
  }
  try {
    await prisma.pmTeamMember.create({
      data: { pmId: me.id, memberId, note: note?.slice(0, 200) || null },
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      // Already in team — idempotent.
      return { ok: true };
    }
    throw e;
  }
  revalidatePath('/team');
  return { ok: true };
}

export async function removeFromPmTeamAction(memberId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только PM/ADMIN' },
    };
  }
  await prisma.pmTeamMember.deleteMany({
    where: { pmId: me.id, memberId },
  });
  revalidatePath('/team');
  return { ok: true };
}

/**
 * List of all active people in the system, decorated with everything
 * the team page needs to show: positions, current load, my-team flag,
 * who else has them.
 */
export async function listTeamMembers(): Promise<TeamMemberRow[]> {
  const me = await requireAuth();
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      positions: { select: { position: true, primary: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Live load: open task counts per user (legacy assigneeId path).
  const taskCounts = await prisma.task.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { not: null },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    _count: { _all: true },
  });
  const taskByUser = new Map<string, number>();
  for (const r of taskCounts) {
    if (r.assigneeId) taskByUser.set(r.assigneeId, r._count._all);
  }
  // Multi-assignment counts.
  const assignCounts = await prisma.taskAssignment.groupBy({
    by: ['userId'],
    where: { task: { internalStatus: { notIn: ['DONE', 'CANCELED'] } } },
    _count: { _all: true },
  });
  const assignByUser = new Map<string, number>();
  for (const r of assignCounts) assignByUser.set(r.userId, r._count._all);

  // Team membership maps.
  const teamRows = await prisma.pmTeamMember.findMany({
    select: { pmId: true, memberId: true },
  });
  const myTeam = new Set<string>();
  const otherPmsByMember = new Map<string, string[]>();
  for (const r of teamRows) {
    if (r.pmId === me.id) myTeam.add(r.memberId);
    else {
      const list = otherPmsByMember.get(r.memberId) ?? [];
      list.push(r.pmId);
      otherPmsByMember.set(r.memberId, list);
    }
  }

  return users.map((u) => {
    const primary = u.positions.find((p) => p.primary)?.position ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      positions: u.positions.map((p) => p.position),
      primaryPosition: primary,
      activeTaskCount: taskByUser.get(u.id) ?? 0,
      activeAssignmentCount: assignByUser.get(u.id) ?? 0,
      inMyTeam: myTeam.has(u.id),
      alsoInPmIds: otherPmsByMember.get(u.id) ?? [],
    };
  });
}
