import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for CRM Leads: create (+ name/contact validation), edit,
 * disqualify/reactivate, soft-delete, and the transactional convert path —
 * contact-only, contact+deal, NO_PIPELINE, idempotency (double-convert), the
 * atomic concurrent-convert lock, and ADMIN/PM gating.
 *
 * Source: apps/web/actions/crm.ts (leads), apps/web/lib/crm.ts (listLeads)
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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
  createDefaultPipelineAction,
  createLeadAction,
  updateLeadAction,
  deleteLeadAction,
  convertLeadAction,
} from '@/actions/crm';
import { listLeads } from '@/lib/crm';
import { makeUser } from './helpers/factories';

async function asAdmin() {
  const admin = await makeUser({ role: 'ADMIN', name: 'Админ Продаж' });
  mockMe.id = admin.id;
  mockMe.role = 'ADMIN';
  return admin;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('CRM leads — create & validation', () => {
  it('creates a NEW lead with email, stamped owner', async () => {
    const admin = await asAdmin();
    const res = await createLeadAction({ name: 'Иван Лид', email: 'ivan@x.ru', source: 'сайт' });
    expect(res.ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: res.ok ? res.data!.id : '' } });
    expect(lead.status).toBe('NEW');
    expect(lead.ownerId).toBe(admin.id);
    expect(lead.source).toBe('сайт');
  });

  it('accepts a phone-only lead', async () => {
    await asAdmin();
    const res = await createLeadAction({ name: 'Только Телефон', phone: '+7 900 000' });
    expect(res.ok).toBe(true);
  });

  it('rejects a name shorter than 2 chars (VALIDATION)', async () => {
    await asAdmin();
    const res = await createLeadAction({ name: 'X', email: 'x@x.x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('rejects a lead with neither email nor phone (VALIDATION)', async () => {
    await asAdmin();
    const res = await createLeadAction({ name: 'Без Контакта' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

describe('CRM leads — edit, disqualify, delete', () => {
  it('edits a lead and flips NEW↔DISQUALIFIED', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Редакт Лид', email: 'r@r.ru' });
    const id = created.ok ? created.data!.id : '';

    const upd = await updateLeadAction(id, { name: 'Новое Имя', email: 'new@r.ru', company: 'ООО' });
    expect(upd.ok).toBe(true);
    let lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.name).toBe('Новое Имя');
    expect(lead.company).toBe('ООО');

    expect((await updateLeadAction(id, { name: 'Новое Имя', email: 'new@r.ru', status: 'DISQUALIFIED' })).ok).toBe(true);
    lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status).toBe('DISQUALIFIED');

    expect((await updateLeadAction(id, { name: 'Новое Имя', email: 'new@r.ru', status: 'NEW' })).ok).toBe(true);
    lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status).toBe('NEW');
  });

  it('soft-deletes a lead (drops from listLeads)', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Удалить Лид', phone: '12345' });
    const id = created.ok ? created.data!.id : '';
    expect((await deleteLeadAction(id)).ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.deletedAt).not.toBeNull();
    expect((await listLeads()).find((l) => l.id === id)).toBeUndefined();
  });

  it('listLeads returns newest-first with ownerName', async () => {
    const admin = await asAdmin();
    await createLeadAction({ name: 'Первый Лид', email: '1@x.ru' });
    const second = await createLeadAction({ name: 'Второй Лид', email: '2@x.ru' });
    const list = await listLeads();
    expect(list[0]?.id).toBe(second.ok ? second.data!.id : '');
    expect(list[0]?.ownerName).toBe(admin.name);
  });
});

describe('CRM leads — convert', () => {
  it('converts contact-only when no pipeline exists', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Конверт Лид', email: 'c@x.ru', company: 'Acme' });
    const id = created.ok ? created.data!.id : '';

    const res = await convertLeadAction(id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.contactId).toBeTruthy();
      expect(res.data!.dealId).toBeNull();
    }
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status).toBe('CONVERTED');
    expect(lead.convertedContactId).toBe(res.ok ? res.data!.contactId : '');
    expect(lead.convertedDealId).toBeNull();
    expect(lead.convertedAt).not.toBeNull();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: res.ok ? res.data!.contactId : '' } });
    expect(contact.name).toBe('Конверт Лид');
    expect(contact.company).toBe('Acme');
    expect(contact.email).toBe('c@x.ru');
  });

  it('returns NO_PIPELINE when a deal is requested but no pipeline exists', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Без Воронки', email: 'np@x.ru' });
    const id = created.ok ? created.data!.id : '';
    const res = await convertLeadAction(id, { createDeal: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NO_PIPELINE');
    // Lead untouched — still NEW, no contact created.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe('NEW');
    expect(await prisma.contact.count()).toBe(0);
  });

  it('converts into a Contact + Deal in the first stage (OPEN)', async () => {
    await asAdmin();
    await createDefaultPipelineAction();
    const created = await createLeadAction({ name: 'Сделка Лид', email: 'd@x.ru' });
    const id = created.ok ? created.data!.id : '';

    const res = await convertLeadAction(id, { createDeal: true, dealTitle: 'Контракт', amount: '90000' });
    expect(res.ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status).toBe('CONVERTED');
    expect(lead.convertedDealId).toBe(res.ok ? res.data!.dealId : '');
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: res.ok ? res.data!.dealId! : '' } });
    expect(deal.status).toBe('OPEN');
    expect(deal.title).toBe('Контракт');
    expect(deal.amount?.toString()).toBe('90000');
    expect(deal.contactId).toBe(res.ok ? res.data!.contactId : '');
    const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: deal.pipelineId }, orderBy: { order: 'asc' } });
    expect(deal.stageId).toBe(stages[0]!.id);
  });

  it('is idempotent: a second convert returns CONFLICT and creates no second contact', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Дубль Лид', email: 'dup@x.ru' });
    const id = created.ok ? created.data!.id : '';
    expect((await convertLeadAction(id)).ok).toBe(true);
    const again = await convertLeadAction(id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('CONFLICT');
    expect(await prisma.contact.count()).toBe(1);
  });

  it('atomic lock: concurrent converts produce exactly one contact', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Гонка Лид', email: 'race@x.ru' });
    const id = created.ok ? created.data!.id : '';
    const results = await Promise.allSettled([convertLeadAction(id), convertLeadAction(id)]);
    const oks = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
    expect(oks).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe('CONVERTED');
  });

  it('rejects converting a soft-deleted lead (NOT_FOUND)', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Удалён Лид', email: 'del@x.ru' });
    const id = created.ok ? created.data!.id : '';
    await deleteLeadAction(id);
    const res = await convertLeadAction(id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('rejects editing a CONVERTED lead (CONFLICT)', async () => {
    await asAdmin();
    const created = await createLeadAction({ name: 'Заморожен Лид', email: 'frozen@x.ru' });
    const id = created.ok ? created.data!.id : '';
    await convertLeadAction(id);
    const res = await updateLeadAction(id, { name: 'Поменять', email: 'frozen@x.ru' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CONFLICT');
  });
});

describe('CRM leads — rbac', () => {
  it('forbids a MEMBER from creating/converting leads', async () => {
    const admin = await asAdmin();
    const created = await createLeadAction({ name: 'Защита Лид', email: 'g@x.ru' });
    const id = created.ok ? created.data!.id : '';

    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';
    expect((await createLeadAction({ name: 'Взлом Лид', email: 'h@x.ru' })).ok).toBe(false);
    expect((await convertLeadAction(id)).ok).toBe(false);
    // Untouched by the forbidden caller.
    void admin;
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe('NEW');
  });
});
