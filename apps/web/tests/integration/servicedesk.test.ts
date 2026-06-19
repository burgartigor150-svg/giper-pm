import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the service desk: intake stamps SLA due times, status
 * transitions stamp firstRespondedAt/resolvedAt (and reopening clears them),
 * assignment, and RBAC (VIEWER cannot log/work tickets).
 *
 * Source: apps/web/actions/servicedesk.ts, lib/servicedesk.ts, lib/servicedesk/sla.ts
 */

const mockMe = {
  id: '',
  role: 'PM' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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

import { prisma } from '@giper/db';
import {
  createTicketAction,
  setTicketStatusAction,
  assignTicketAction,
} from '@/actions/servicedesk';
import { listTickets } from '@/lib/servicedesk';
import { DEFAULT_SLA } from '@/lib/servicedesk/sla';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'PM';
});

describe('service desk — intake & SLA', () => {
  it('creates a ticket and stamps SLA due times from the priority policy', async () => {
    mockMe.id = (await makeUser({ role: 'PM' })).id;
    const res = await createTicketAction({
      subject: 'Не открывается отчёт',
      requesterName: 'Клиент Иванов',
      requesterEmail: 'client@acme.test',
      priority: 'HIGH',
    });
    expect(res.ok).toBe(true);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: res.ok ? res.data!.id : '' } });
    expect(t.status).toBe('OPEN');
    expect(t.firstResponseDueAt).not.toBeNull();
    // resolution due ≈ created + HIGH.resolutionHours.
    const gap = t.resolutionDueAt!.getTime() - t.createdAt.getTime();
    expect(Math.round(gap / 3_600_000)).toBe(DEFAULT_SLA.HIGH.resolutionHours);

    const list = await listTickets();
    expect(list.some((x) => x.id === t.id)).toBe(true);
  });

  it('stamps firstRespondedAt on leaving OPEN and resolvedAt on RESOLVED; reopening clears resolvedAt', async () => {
    mockMe.id = (await makeUser({ role: 'PM' })).id;
    const created = await createTicketAction({ subject: 'Запрос доступа', requesterName: 'Пётр' });
    const id = created.ok ? created.data!.id : '';

    await setTicketStatusAction(id, 'IN_PROGRESS');
    let t = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.firstRespondedAt).not.toBeNull();
    expect(t.resolvedAt).toBeNull();

    await setTicketStatusAction(id, 'RESOLVED');
    t = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.resolvedAt).not.toBeNull();

    await setTicketStatusAction(id, 'IN_PROGRESS');
    t = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.resolvedAt).toBeNull(); // reopened
  });

  it('assigns a ticket to an agent', async () => {
    mockMe.id = (await makeUser({ role: 'PM' })).id;
    const agent = await makeUser();
    const created = await createTicketAction({ subject: 'Тема', requesterName: 'Имя' });
    const id = created.ok ? created.data!.id : '';
    const res = await assignTicketAction(id, agent.id);
    expect(res.ok).toBe(true);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.assigneeId).toBe(agent.id);
  });

  it('forbids a VIEWER from logging a ticket', async () => {
    mockMe.id = (await makeUser({ role: 'VIEWER' })).id;
    mockMe.role = 'VIEWER';
    const res = await createTicketAction({ subject: 'Нельзя', requesterName: 'Кто-то' });
    expect(res.ok).toBe(false);
  });
});
