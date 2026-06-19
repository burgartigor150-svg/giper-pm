'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canSeeServiceDesk, canWorkTickets } from '@/lib/permissions';
import { computeDueAts, type Priority } from '@/lib/servicedesk/sla';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DENY = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } } as const;
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']);
const DONE = new Set(['RESOLVED', 'CLOSED']);

/** Log a new ticket. SLA due times are stamped from the priority policy. */
export async function createTicketAction(input: {
  subject: string;
  requesterName: string;
  requesterEmail?: string;
  description?: string;
  priority?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  // Intake is an agent action: gate it like queue visibility (ADMIN/PM), so a
  // creator can always see the ticket they just logged. Was canWorkTickets,
  // which let a MEMBER create tickets they could never open.
  if (!canSeeServiceDesk({ id: me.id, role: me.role })) return DENY;
  if (input.subject.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Тема ≥ 2 символов' } };
  }
  if (input.requesterName.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя заявителя ≥ 2 символов' } };
  }
  const priority = (PRIORITIES.has(input.priority ?? '') ? input.priority : 'MEDIUM') as Priority;
  const now = new Date();
  const { firstResponseDueAt, resolutionDueAt } = computeDueAts(priority, now);

  const ticket = await prisma.ticket.create({
    data: {
      subject: input.subject.trim().slice(0, 300),
      requesterName: input.requesterName.trim().slice(0, 200),
      requesterEmail: input.requesterEmail?.trim().slice(0, 200) || null,
      description: input.description?.slice(0, 20_000) || null,
      priority,
      firstResponseDueAt,
      resolutionDueAt,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/servicedesk');
  return { ok: true, data: { id: ticket.id } };
}

/**
 * Change a ticket's status. Moving away from OPEN stamps firstRespondedAt
 * (the agent engaged → response clock stops); reaching RESOLVED/CLOSED stamps
 * resolvedAt; reopening clears resolvedAt.
 */
export async function setTicketStatusAction(ticketId: string, status: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canWorkTickets({ id: me.id, role: me.role })) return DENY;
  if (!STATUSES.has(status)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неизвестный статус' } };
  }
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { firstRespondedAt: true },
  });
  if (!ticket) return { ok: false, error: { code: 'NOT_FOUND', message: 'Тикет не найден' } };

  const now = new Date();
  const done = DONE.has(status);
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: status as never,
      firstRespondedAt:
        status !== 'OPEN' && !ticket.firstRespondedAt ? now : undefined,
      resolvedAt: done ? now : status === 'OPEN' || status === 'IN_PROGRESS' || status === 'WAITING' ? null : undefined,
    },
  });
  revalidatePath('/servicedesk');
  return { ok: true };
}

/** Assign (or unassign) a ticket to an agent. */
export async function assignTicketAction(ticketId: string, assigneeId: string | null): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canWorkTickets({ id: me.id, role: me.role })) return DENY;
  if (assigneeId) {
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true } });
    if (!u) return { ok: false, error: { code: 'VALIDATION', message: 'Пользователь не найден' } };
  }
  await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId } }).catch(() => {});
  revalidatePath('/servicedesk');
  return { ok: true };
}
