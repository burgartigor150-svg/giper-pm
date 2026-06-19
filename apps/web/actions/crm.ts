'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canDeleteCrmPipeline, canEditCrm } from '@/lib/permissions';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DENY = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только продажи (ADMIN/PM)' } } as const;

function parseAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Seed a default "Продажи" pipeline with standard stages (idempotent-ish). */
export async function createDefaultPipelineAction(): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  const existing = await prisma.pipeline.findFirst({ where: { archivedAt: null }, select: { id: true } });
  if (existing) return { ok: true, data: { id: existing.id } };

  const p = await prisma.pipeline.create({
    data: {
      name: 'Продажи',
      order: 0,
      createdById: me.id,
      stages: {
        create: [
          { name: 'Новые', order: 0 },
          { name: 'Квалификация', order: 1 },
          { name: 'Предложение', order: 2 },
          { name: 'Выиграно', order: 3, kind: 'WON' },
          { name: 'Проиграно', order: 4, kind: 'LOST' },
        ],
      },
    },
    select: { id: true },
  });
  revalidatePath('/crm');
  return { ok: true, data: { id: p.id } };
}

/** Create a deal. Defaults to the pipeline's first stage when none given. */
export async function createDealAction(input: {
  pipelineId: string;
  title: string;
  amount?: string | number | null;
  contactId?: string | null;
  stageId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  if (input.title.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название сделки ≥ 2 символов' } };
  }
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: input.pipelineId },
    orderBy: { order: 'asc' },
    select: { id: true, kind: true },
  });
  if (stages.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'В воронке нет стадий' } };
  }
  const stage = input.stageId
    ? stages.find((s) => s.id === input.stageId)
    : stages[0];
  if (!stage) return { ok: false, error: { code: 'VALIDATION', message: 'Стадия не из этой воронки' } };

  const terminal = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
  const deal = await prisma.deal.create({
    data: {
      pipelineId: input.pipelineId,
      stageId: stage.id,
      title: input.title.trim().slice(0, 200),
      amount: parseAmount(input.amount),
      contactId: input.contactId || null,
      ownerId: me.id,
      createdById: me.id,
      status: terminal,
      closedAt: terminal === 'OPEN' ? null : new Date(),
    },
    select: { id: true },
  });
  revalidatePath('/crm');
  return { ok: true, data: { id: deal.id } };
}

/** Move a deal to another stage in the same pipeline; flips WON/LOST on terminal stages. */
export async function moveDealStageAction(dealId: string, stageId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { pipelineId: true, status: true },
  });
  if (!deal) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } };
  const stage = await prisma.pipelineStage.findUnique({
    where: { id: stageId },
    select: { pipelineId: true, kind: true },
  });
  if (!stage || stage.pipelineId !== deal.pipelineId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Стадия не из этой воронки' } };
  }
  const nextStatus = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      stageId,
      status: nextStatus,
      closedAt: nextStatus === 'OPEN' ? null : new Date(),
    },
  });
  revalidatePath('/crm');
  return { ok: true };
}

/** Explicitly set a deal's WON/LOST/OPEN status (e.g. from the card buttons). */
export async function setDealStatusAction(
  dealId: string,
  status: 'OPEN' | 'WON' | 'LOST',
  opts: { lostReason?: string } = {},
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      status,
      closedAt: status === 'OPEN' ? null : new Date(),
      lostReason: status === 'LOST' ? (opts.lostReason?.slice(0, 2000) ?? null) : null,
    },
  });
  revalidatePath('/crm');
  return { ok: true };
}

/** Create a contact. */
export async function createContactAction(input: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  const c = await prisma.contact.create({
    data: {
      name: input.name.trim().slice(0, 200),
      company: input.company?.trim().slice(0, 200) || null,
      email: input.email?.trim().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 60) || null,
      ownerId: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/crm/contacts');
  return { ok: true, data: { id: c.id } };
}

/** Edit an existing contact. CRM editors (ADMIN/PM) only. */
export async function updateContactAction(
  contactId: string,
  input: { name: string; company?: string; email?: string; phone?: string },
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  try {
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        name: input.name.trim().slice(0, 200),
        company: input.company?.trim().slice(0, 200) || null,
        email: input.email?.trim().slice(0, 200) || null,
        phone: input.phone?.trim().slice(0, 60) || null,
      },
    });
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Контакт не найден' } };
  }
  revalidatePath('/crm/contacts');
  return { ok: true };
}

/** Soft-delete a contact (sets deletedAt; deals are kept). CRM editors only. */
export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  try {
    await prisma.contact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });
  } catch {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Контакт не найден' } };
  }
  revalidatePath('/crm/contacts');
  return { ok: true };
}

/** Archive (soft-delete) a pipeline. ADMIN only. */
export async function archivePipelineAction(pipelineId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canDeleteCrmPipeline({ id: me.id, role: me.role })) return DENY;
  await prisma.pipeline.update({ where: { id: pipelineId }, data: { archivedAt: new Date() } }).catch(() => {});
  revalidatePath('/crm');
  return { ok: true };
}
