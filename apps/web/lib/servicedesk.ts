import { prisma } from '@giper/db';

export type TicketRow = {
  id: string;
  subject: string;
  requesterName: string;
  requesterEmail: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';
  assigneeId: string | null;
  assigneeName: string | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

/**
 * All tickets for the agent queue, newest first. Fault-tolerant: returns []
 * if the table isn't there yet (image live a beat before migrate deploy).
 */
export async function listTickets(): Promise<TicketRow[]> {
  try {
    const rows = await prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        requesterName: true,
        requesterEmail: true,
        priority: true,
        status: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        createdAt: true,
        assigneeId: true,
        assignee: { select: { name: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      requesterName: t.requesterName,
      requesterEmail: t.requesterEmail,
      priority: t.priority,
      status: t.status,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee?.name ?? null,
      firstResponseDueAt: t.firstResponseDueAt,
      resolutionDueAt: t.resolutionDueAt,
      firstRespondedAt: t.firstRespondedAt,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt,
    }));
  } catch (e) {
    console.warn('listTickets: unavailable', e);
    return [];
  }
}
