import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the CRM: default-pipeline seed, deal create (with
 * terminal-stage status flip), stage move (WON/LOST flip + reopen + cross-
 * pipeline reject), contact create, summary aggregation, and ADMIN/PM gating.
 *
 * Source: apps/web/actions/crm.ts, apps/web/lib/crm.ts
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
  moveDealStageAction,
  setDealStatusAction,
  createContactAction,
} from '@/actions/crm';
import { listPipelines, getPipelineSummary } from '@/lib/crm';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function setup() {
  const admin = await makeUser({ role: 'ADMIN' });
  mockMe.id = admin.id;
  mockMe.role = 'ADMIN';
  const res = await createDefaultPipelineAction();
  const pipelineId = res.ok ? res.data!.id : '';
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId },
    orderBy: { order: 'asc' },
    select: { id: true, kind: true, name: true },
  });
  return { admin, pipelineId, stages };
}

describe('CRM — pipeline & deals', () => {
  it('seeds a default pipeline with 5 stages (idempotent)', async () => {
    const { pipelineId } = await setup();
    expect(pipelineId).toBeTruthy();
    const list = await listPipelines();
    expect(list).toHaveLength(1);
    expect(list[0]?.stages).toHaveLength(5);
    // second call returns the same pipeline, not a duplicate.
    const again = await createDefaultPipelineAction();
    expect(again.ok && again.data?.id).toBe(pipelineId);
  });

  it('creates a deal in the first stage as OPEN', async () => {
    const { pipelineId, stages } = await setup();
    const res = await createDealAction({ pipelineId, title: 'Большая сделка', amount: '150000' });
    expect(res.ok).toBe(true);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: res.ok ? res.data!.id : '' } });
    expect(deal.stageId).toBe(stages[0]!.id);
    expect(deal.status).toBe('OPEN');
    expect(deal.amount?.toString()).toBe('150000');
  });

  it('moving to a WON stage flips status + stamps closedAt; reopening clears it', async () => {
    const { pipelineId, stages } = await setup();
    const won = stages.find((s) => s.kind === 'WON')!;
    const first = stages[0]!;
    const created = await createDealAction({ pipelineId, title: 'Сделка', amount: '10' });
    const dealId = created.ok ? created.data!.id : '';

    await moveDealStageAction(dealId, won.id);
    let d = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(d.status).toBe('WON');
    expect(d.closedAt).not.toBeNull();

    await moveDealStageAction(dealId, first.id);
    d = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(d.status).toBe('OPEN');
    expect(d.closedAt).toBeNull();
  });

  it('rejects moving a deal to a stage from another pipeline', async () => {
    const { pipelineId } = await setup();
    const created = await createDealAction({ pipelineId, title: 'Сделка' });
    const dealId = created.ok ? created.data!.id : '';
    // A foreign stage (own pipeline + stages).
    const foreign = await prisma.pipeline.create({
      data: { name: 'Другая', stages: { create: [{ name: 'X', order: 0 }] } },
      select: { stages: { select: { id: true } } },
    });
    const res = await moveDealStageAction(dealId, foreign.stages[0]!.id);
    expect(res.ok).toBe(false);
  });

  it('setDealStatus WON/LOST/OPEN stamps and clears closedAt', async () => {
    const { pipelineId } = await setup();
    const created = await createDealAction({ pipelineId, title: 'Сделка' });
    const dealId = created.ok ? created.data!.id : '';
    await setDealStatusAction(dealId, 'LOST', { lostReason: 'дорого' });
    let d = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(d.status).toBe('LOST');
    expect(d.lostReason).toBe('дорого');
    expect(d.closedAt).not.toBeNull();
    await setDealStatusAction(dealId, 'OPEN');
    d = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(d.closedAt).toBeNull();
    expect(d.lostReason).toBeNull();
  });

  it('summary aggregates open/won values and win rate', async () => {
    const { pipelineId, stages } = await setup();
    const won = stages.find((s) => s.kind === 'WON')!;
    const lost = stages.find((s) => s.kind === 'LOST')!;
    const open = await createDealAction({ pipelineId, title: 'Open', amount: '100' });
    const w = await createDealAction({ pipelineId, title: 'Won', amount: '200' });
    const l = await createDealAction({ pipelineId, title: 'Lost', amount: '50' });
    await moveDealStageAction(w.ok ? w.data!.id : '', won.id);
    await moveDealStageAction(l.ok ? l.data!.id : '', lost.id);

    const sum = await getPipelineSummary(pipelineId);
    expect(sum.openValue).toBe(100);
    expect(sum.wonValue).toBe(200);
    expect(sum.openCount).toBe(1);
    expect(sum.wonCount).toBe(1);
    expect(sum.lostCount).toBe(1);
    expect(sum.winRate).toBe(50); // 1 won of 2 closed
  });
});

describe('CRM — contacts & rbac', () => {
  it('creates a contact', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await createContactAction({ name: 'Иван Петров', company: 'ООО Ромашка' });
    expect(res.ok).toBe(true);
  });

  it('forbids a MEMBER from CRM writes', async () => {
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';
    expect((await createDefaultPipelineAction()).ok).toBe(false);
    expect((await createContactAction({ name: 'X Y' })).ok).toBe(false);
  });
});
