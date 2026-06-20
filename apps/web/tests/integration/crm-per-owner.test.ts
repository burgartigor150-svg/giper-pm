import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Per-owner CRM access (opt-in User.crmAccess flag). Verifies:
 * - the flag gate (inert default, grant, VIEWER hard-exclusion, ADMIN/PM scope 'all'),
 * - cross-owner READ isolation for deals / contacts / leads / summary,
 * - cross-owner WRITE isolation on ALL 8 id-targeted mutators (NOT_FOUND, no mutation),
 * - filtered contact deal-count, convert own-only, pipeline structure stays ADMIN/PM,
 * - flag is read from the DB per request (revoke takes effect immediately),
 * - the admin grant/revoke path (lib updateUser).
 *
 * Runs against REAL Postgres — filtered _count + updateMany count semantics
 * are not mock-faithful. Actions read the flag via getMyCrmAccess from the DB
 * row created by makeUser, so set crmAccess at creation and switch mockMe per test.
 *
 * Source: apps/web/actions/crm.ts, apps/web/lib/crm.ts, apps/web/lib/permissions.ts
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
  createDealAction,
  updateDealAction,
  moveDealStageAction,
  setDealStatusAction,
  createContactAction,
  updateContactAction,
  deleteContactAction,
  createLeadAction,
  updateLeadAction,
  deleteLeadAction,
  convertLeadAction,
  archivePipelineAction,
} from '@/actions/crm';
import {
  listDealsForPipeline,
  getPipelineSummary,
  listContacts,
  listLeads,
} from '@/lib/crm';
import { updateUser } from '@/lib/users';
import { makeUser, makeProject, makeTask } from './helpers/factories';

function be(user: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = user.id;
  mockMe.role = user.role;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

/** ADMIN seeds the shared default pipeline; returns its id + ordered stages. */
async function seedPipeline() {
  const admin = await makeUser({ role: 'ADMIN' });
  be(admin);
  const res = await createDefaultPipelineAction();
  const pipelineId = res.ok ? res.data!.id : '';
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId },
    orderBy: { order: 'asc' },
    select: { id: true, kind: true },
  });
  return { admin, pipelineId, stages };
}

describe('CRM per-owner — access gate', () => {
  it('inert by default: a MEMBER without the flag is denied all CRM writes', async () => {
    const m = await makeUser({ role: 'MEMBER', crmAccess: false });
    be(m);
    expect((await createContactAction({ name: 'Нельзя' })).ok).toBe(false);
    expect((await createLeadAction({ name: 'Нельзя', email: 'x@x.x' })).ok).toBe(false);
  });

  it('granted: a MEMBER with the flag can create, stamped as owner', async () => {
    const rep = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(rep);
    const c = await createContactAction({ name: 'Мой Контакт' });
    expect(c.ok).toBe(true);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.ok ? c.data!.id : '' } })).ownerId).toBe(rep.id);
    const l = await createLeadAction({ name: 'Мой Лид', email: 'l@x.ru' });
    expect(l.ok).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.ok ? l.data!.id : '' } })).ownerId).toBe(rep.id);
  });

  it('VIEWER is hard-excluded even with the flag set', async () => {
    const v = await makeUser({ role: 'VIEWER', crmAccess: true });
    be(v);
    expect((await createContactAction({ name: 'Зритель' })).ok).toBe(false);
    expect((await createLeadAction({ name: 'Зритель', email: 'v@x.ru' })).ok).toBe(false);
  });

  it('ADMIN/PM keep scope all regardless of the flag value', async () => {
    const pm = await makeUser({ role: 'PM', crmAccess: false });
    be(pm);
    expect((await createContactAction({ name: 'ПМ Контакт' })).ok).toBe(true);
  });
});

describe('CRM per-owner — deals isolation', () => {
  it('a scoped rep sees only their own deals; ADMIN sees all', async () => {
    const { pipelineId, admin } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(a); const da = await createDealAction({ pipelineId, title: 'Сделка A', amount: '100' });
    be(b); const db = await createDealAction({ pipelineId, title: 'Сделка B', amount: '200' });
    const aId = da.ok ? da.data!.id : '', bId = db.ok ? db.data!.id : '';

    const aSees = await listDealsForPipeline(pipelineId, a.id);
    expect(aSees.map((d) => d.id).sort()).toEqual([aId]);
    const allSees = await listDealsForPipeline(pipelineId, null);
    expect(allSees.map((d) => d.id).sort()).toEqual([aId, bId].sort());
    void admin;
  });

  it('a scoped rep cannot mutate another owner’s deal (all 3 deal mutators → NOT_FOUND)', async () => {
    const { pipelineId, stages } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(b); const db = await createDealAction({ pipelineId, title: 'B защита', amount: '5' });
    const bId = db.ok ? db.data!.id : '';

    be(a);
    const r1 = await updateDealAction(bId, { title: 'Взлом' });
    expect(r1.ok).toBe(false); if (!r1.ok) expect(r1.error.code).toBe('NOT_FOUND');
    const r2 = await moveDealStageAction(bId, stages.find((s) => s.kind === 'WON')!.id);
    expect(r2.ok).toBe(false); if (!r2.ok) expect(r2.error.code).toBe('NOT_FOUND');
    const r3 = await setDealStatusAction(bId, 'WON');
    expect(r3.ok).toBe(false); if (!r3.ok) expect(r3.error.code).toBe('NOT_FOUND');

    const after = await prisma.deal.findUniqueOrThrow({ where: { id: bId } });
    expect(after.title).toBe('B защита');
    expect(after.status).toBe('OPEN');
    expect(after.stageId).toBe(stages[0]!.id);
  });

  it('summary is scoped consistently with the visible deal list', async () => {
    const { pipelineId } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(a);
    await createDealAction({ pipelineId, title: 'A1', amount: '40' });
    await createDealAction({ pipelineId, title: 'A2', amount: '60' });
    be(b);
    await createDealAction({ pipelineId, title: 'B1', amount: '300' });
    await createDealAction({ pipelineId, title: 'B2', amount: '300' });
    await createDealAction({ pipelineId, title: 'B3', amount: '300' });

    const aList = await listDealsForPipeline(pipelineId, a.id);
    const aSum = await getPipelineSummary(pipelineId, a.id);
    expect(aSum.openCount).toBe(aList.length);
    expect(aSum.openCount).toBe(2);
    expect(aSum.openValue).toBe(100);

    const allSum = await getPipelineSummary(pipelineId, null);
    expect(allSum.openCount).toBe(5);
    expect(allSum.openValue).toBe(1000);
  });
});

describe('CRM per-owner — contacts & leads isolation', () => {
  it('contacts: scoped read + write bypass blocked', async () => {
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(a); const ca = await createContactAction({ name: 'Контакт A' });
    be(b); const cb = await createContactAction({ name: 'Контакт B' });
    const aId = ca.ok ? ca.data!.id : '', bId = cb.ok ? cb.data!.id : '';

    be(a);
    expect((await listContacts(a.id)).map((c) => c.id)).toEqual([aId]);
    const u = await updateContactAction(bId, { name: 'Взлом' });
    expect(u.ok).toBe(false); if (!u.ok) expect(u.error.code).toBe('NOT_FOUND');
    const d = await deleteContactAction(bId);
    expect(d.ok).toBe(false); if (!d.ok) expect(d.error.code).toBe('NOT_FOUND');
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: bId } });
    expect(after.name).toBe('Контакт B');
    expect(after.deletedAt).toBeNull();
  });

  it('contact deal-count is owner-filtered for a scoped rep', async () => {
    const { pipelineId, admin } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    // A owns a contact + a deal on it. ADMIN (scope 'all', unrestricted) adds a
    // second deal on the SAME contact → the contact carries deals from 2 owners.
    be(a); const ca = await createContactAction({ name: 'Общий Контакт' });
    const contactId = ca.ok ? ca.data!.id : '';
    be(a); await createDealAction({ pipelineId, title: 'A deal', contactId });
    be(admin); await createDealAction({ pipelineId, title: 'Admin deal', contactId });

    be(a);
    const aRow = (await listContacts(a.id)).find((c) => c.id === contactId);
    expect(aRow?.dealCount).toBe(1); // only A's deal
    const adminRow = (await listContacts(null)).find((c) => c.id === contactId);
    expect(adminRow?.dealCount).toBe(2); // both
  });

  it('leads: scoped read + write bypass + convert own-only', async () => {
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(a); const la = await createLeadAction({ name: 'Лид A', email: 'a@x.ru' });
    be(b); const lb = await createLeadAction({ name: 'Лид B', email: 'b@x.ru' });
    const aId = la.ok ? la.data!.id : '', bId = lb.ok ? lb.data!.id : '';

    be(a);
    expect((await listLeads(a.id)).map((l) => l.id)).toEqual([aId]);
    const u = await updateLeadAction(bId, { name: 'Взлом', email: 'b@x.ru' });
    expect(u.ok).toBe(false); if (!u.ok) expect(u.error.code).toBe('NOT_FOUND');
    const d = await deleteLeadAction(bId);
    expect(d.ok).toBe(false); if (!d.ok) expect(d.error.code).toBe('NOT_FOUND');
    // Convert someone else's lead → NOT_FOUND, leadB stays NEW, no contact made.
    const cv = await convertLeadAction(bId);
    expect(cv.ok).toBe(false); if (!cv.ok) expect(cv.error.code).toBe('NOT_FOUND');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: bId } })).status).toBe('NEW');

    // Convert own lead → succeeds, contact owned by A.
    const ok = await convertLeadAction(aId);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: ok.data!.contactId } })).ownerId).toBe(a.id);
    }
  });
});

describe('CRM per-owner — pipeline structure & flag source-of-truth', () => {
  it('a scoped rep cannot create or archive pipelines (ADMIN/PM-only)', async () => {
    const { pipelineId } = await seedPipeline();
    const rep = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(rep);
    expect((await createDefaultPipelineAction()).ok).toBe(false);
    const arch = await archivePipelineAction(pipelineId);
    expect(arch.ok).toBe(false); if (!arch.ok) expect(arch.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect((await prisma.pipeline.findUniqueOrThrow({ where: { id: pipelineId } })).archivedAt).toBeNull();
  });

  it('revoking the flag takes effect on the very next request (DB-per-request read)', async () => {
    const rep = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(rep);
    expect((await createContactAction({ name: 'Пока можно' })).ok).toBe(true);
    // Revoke directly in the DB.
    await prisma.user.update({ where: { id: rep.id }, data: { crmAccess: false } });
    expect((await createContactAction({ name: 'Уже нельзя' })).ok).toBe(false);
  });

  it('admin grant/revoke via updateUser persists the flag; non-admin is forbidden', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const rep = await makeUser({ role: 'MEMBER', crmAccess: false });
    await updateUser(rep.id, { crmAccess: true }, { id: admin.id, role: 'ADMIN' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rep.id } })).crmAccess).toBe(true);
    await expect(
      updateUser(rep.id, { crmAccess: false }, { id: rep.id, role: 'MEMBER' }),
    ).rejects.toThrow();
    // Still true — the forbidden call didn't persist.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rep.id } })).crmAccess).toBe(true);
  });
});

describe('CRM per-owner — scope all & cross-owner link hardening', () => {
  // Pins the scope 'all' → empty-filter invariant: a broken ownWhere('all') that
  // wrongly returned {ownerId: meId} would lock admins out of foreign records and
  // every other test would still pass green.
  it('ADMIN can mutate records owned by a different user (scope all)', async () => {
    const { pipelineId } = await seedPipeline();
    const rep = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(rep);
    const da = await createDealAction({ pipelineId, title: 'Rep deal', amount: '10' });
    const ca = await createContactAction({ name: 'Rep contact' });
    const la = await createLeadAction({ name: 'Rep lead', email: 'rep@x.ru' });
    const dealId = da.ok ? da.data!.id : '';
    const contactId = ca.ok ? ca.data!.id : '';
    const leadId = la.ok ? la.data!.id : '';

    const admin = await makeUser({ role: 'ADMIN' });
    be(admin);
    expect((await updateDealAction(dealId, { title: 'Admin touched' })).ok).toBe(true);
    expect((await updateContactAction(contactId, { name: 'Admin touched' })).ok).toBe(true);
    expect((await updateLeadAction(leadId, { name: 'Admin touched', email: 'rep@x.ru' })).ok).toBe(true);

    expect((await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).title).toBe('Admin touched');
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).name).toBe('Admin touched');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).name).toBe('Admin touched');
  });

  it('a scoped rep cannot link a foreign contact to their own deal', async () => {
    const { pipelineId } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    const b = await makeUser({ role: 'MEMBER', crmAccess: true });
    be(b); const cb = await createContactAction({ name: 'B contact' });
    const foreignContactId = cb.ok ? cb.data!.id : '';

    be(a);
    const created = await createDealAction({ pipelineId, title: 'Чужой контакт', contactId: foreignContactId });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('VALIDATION');
    // Own contact links fine.
    const own = await createContactAction({ name: 'A contact' });
    const okDeal = await createDealAction({ pipelineId, title: 'Свой контакт', contactId: own.ok ? own.data!.id : '' });
    expect(okDeal.ok).toBe(true);
  });

  it('a scoped rep cannot link a project they have no stake in; a member project links fine', async () => {
    const { pipelineId, admin } = await seedPipeline();
    const a = await makeUser({ role: 'MEMBER', crmAccess: true });
    // Project owned by admin — rep A has no stake → invisible → not linkable.
    const foreign = await makeProject({ ownerId: admin.id, key: 'FOR', name: 'Foreign' });
    be(a);
    const bad = await createDealAction({ pipelineId, title: 'Чужой проект', projectId: foreign.id });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION');
    // Give A a real task stake (creator) → project becomes visible → linkable.
    // (listProjectsForUser counts task-stake/Bitrix membership, not ProjectMember.)
    await makeTask({ projectId: foreign.id, creatorId: a.id });
    be(a);
    const good = await createDealAction({ pipelineId, title: 'Свой проект', projectId: foreign.id });
    expect(good.ok).toBe(true);
  });
});
